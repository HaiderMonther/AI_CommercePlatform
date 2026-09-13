import { Inject, Injectable } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { PaginatedResult, paginate } from '@common/dto/pagination.dto';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { slugify } from '@common/utils/slug.util';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  description: true,
  price: true,
  salePrice: true,
  costPrice: true,
  currency: true,
  stock: true,
  reservedStock: true,
  lowStockThreshold: true,
  trackInventory: true,
  hasVariants: true,
  tags: true,
  isActive: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  images: {
    select: { id: true, url: true, alt: true, isPrimary: true, sortOrder: true },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
  },
  _count: { select: { variants: { where: { deletedAt: null } } } },
} as const satisfies Prisma.ProductSelect;

@Injectable()
export class ProductsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly context: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: QueryProductsDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.outOfStock ? { stock: { lte: 0 }, trackInventory: true } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { tags: { has: query.search } },
            ],
          }
        : {}),
    };

    // Comparing two columns needs a raw fragment; Prisma's filters compare to values only.
    if (query.lowStock) {
      where.AND = [
        { trackInventory: true },
        {
          id: {
            in: (
              await this.prisma.$queryRaw<{ id: string }[]>`
                SELECT id FROM products
                WHERE "companyId" = ${this.requireCompanyId()}
                  AND "deletedAt" IS NULL
                  AND "trackInventory" = true
                  AND stock <= "lowStockThreshold"
              `
            ).map((row) => row.id),
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.db.product.findMany({
        where,
        select: PRODUCT_SELECT,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.limit,
      }),
      this.db.product.count({ where }),
    ]);

    return paginate(items.map((item) => this.toView(item)), total, query.page, query.limit);
  }

  async findOne(id: string) {
    const product = await this.db.product.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...PRODUCT_SELECT,
        variants: {
          where: { deletedAt: null },
          select: {
            id: true,
            sku: true,
            name: true,
            attributes: true,
            price: true,
            salePrice: true,
            costPrice: true,
            stock: true,
            reservedStock: true,
            imageUrl: true,
            isActive: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundAppException('المنتج غير موجود', ERROR_CODE.PRODUCT_NOT_FOUND);
    }

    return {
      ...this.toView(product),
      variants: product.variants.map((variant) => ({
        ...variant,
        price: this.toNumber(variant.price),
        salePrice: this.toNumber(variant.salePrice),
        costPrice: this.toNumber(variant.costPrice),
        availableStock: variant.stock - variant.reservedStock,
      })),
    };
  }

  /**
   * Creates the product and, when an opening quantity is given, books it as a STOCK_IN
   * movement in the same transaction — so even the first unit has a ledger entry.
   */
  async create(dto: CreateProductDto) {
    const companyId = this.requireCompanyId();

    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    const sku = await this.resolveSku(dto.sku, dto.name);

    const productId = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          companyId,
          name: dto.name,
          sku,
          description: dto.description ?? null,
          price: new Prisma.Decimal(dto.price),
          salePrice: dto.salePrice !== undefined ? new Prisma.Decimal(dto.salePrice) : null,
          costPrice: dto.costPrice !== undefined ? new Prisma.Decimal(dto.costPrice) : null,
          categoryId: dto.categoryId ?? null,
          stock: 0,
          lowStockThreshold: dto.lowStockThreshold ?? 5,
          trackInventory: dto.trackInventory ?? true,
          isActive: dto.isActive ?? true,
          tags: dto.tags ?? [],
          images: dto.images?.length
            ? {
                createMany: {
                  data: dto.images.map((image, index) => ({
                    url: image.url,
                    alt: image.alt ?? null,
                    isPrimary: image.isPrimary ?? index === 0,
                    sortOrder: index,
                  })),
                },
              }
            : undefined,
        },
        select: { id: true },
      });

      if (dto.initialStock && dto.initialStock > 0 && (dto.trackInventory ?? true)) {
        await this.inventory.recordMovement(
          {
            productId: product.id,
            type: InventoryMovementType.STOCK_IN,
            quantity: dto.initialStock,
            unitCost: dto.costPrice ?? null,
            reason: 'الكمية الابتدائية عند إنشاء المنتج',
            referenceType: 'Manual',
          },
          tx,
        );
      }

      return product.id;
    });

    const created = await this.findOne(productId);

    await this.audit.record({
      action: AUDIT_ACTION.CREATE,
      entity: AUDIT_ENTITY.PRODUCT,
      entityId: productId,
      newValue: created,
    });

    return created;
  }

  async update(id: string, dto: UpdateProductDto) {
    const before = await this.findOne(id);

    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    if (dto.sku && dto.sku !== before.sku) {
      await this.assertSkuAvailable(dto.sku);
    }

    await this.db.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
        ...(dto.salePrice !== undefined
          ? { salePrice: dto.salePrice === null ? null : new Prisma.Decimal(dto.salePrice) }
          : {}),
        ...(dto.costPrice !== undefined
          ? { costPrice: dto.costPrice === null ? null : new Prisma.Decimal(dto.costPrice) }
          : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
        ...(dto.lowStockThreshold !== undefined
          ? { lowStockThreshold: dto.lowStockThreshold }
          : {}),
        ...(dto.trackInventory !== undefined ? { trackInventory: dto.trackInventory } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
      },
    });

    if (dto.images) {
      await this.replaceImages(id, dto.images);
    }

    const updated = await this.findOne(id);

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.PRODUCT,
      entityId: id,
      oldValue: before,
      newValue: updated,
    });

    return updated;
  }

  /**
   * Soft delete that frees the SKU for reuse. The row stays so historical order items
   * keep resolving to a real product.
   */
  async remove(id: string): Promise<void> {
    const product = await this.findOne(id);
    const deletedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          deletedAt,
          isActive: false,
          sku: `${product.sku}.deleted.${deletedAt.getTime()}`,
        },
      });

      await tx.productVariant.updateMany({
        where: { productId: id, deletedAt: null },
        data: { deletedAt, isActive: false },
      });
    });

    await this.audit.record({
      action: AUDIT_ACTION.DELETE,
      entity: AUDIT_ENTITY.PRODUCT,
      entityId: id,
      oldValue: product,
    });
  }

  private async replaceImages(
    productId: string,
    images: { url: string; alt?: string; isPrimary?: boolean }[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({ where: { productId } });

      if (images.length > 0) {
        await tx.productImage.createMany({
          data: images.map((image, index) => ({
            productId,
            url: image.url,
            alt: image.alt ?? null,
            isPrimary: image.isPrimary ?? index === 0,
            sortOrder: index,
          })),
        });
      }
    });
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.db.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestAppException('التصنيف غير موجود');
    }
  }

  private async assertSkuAvailable(sku: string): Promise<void> {
    const existing = await this.db.product.findFirst({
      where: { sku, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictAppException('رمز المنتج مستخدم مسبقاً', ERROR_CODE.SKU_ALREADY_USED);
    }
  }

  /** Uses the given SKU when free, otherwise derives a unique one from the product name. */
  private async resolveSku(requested: string | undefined, name: string): Promise<string> {
    if (requested) {
      await this.assertSkuAvailable(requested);
      return requested;
    }

    const base =
      slugify(name)
        .replace(/-/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 10) || 'PRD';

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = `${base}-${String(Date.now() % 100000).padStart(5, '0')}${
        attempt > 0 ? `-${attempt}` : ''
      }`;
      const existing = await this.db.product.findFirst({
        where: { sku: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }

    return `${base}-${Date.now().toString(36).toUpperCase()}`;
  }

  private toNumber(value: Prisma.Decimal | null): number | null {
    return value === null ? null : Number(value);
  }

  /**
   * Converts Prisma Decimals to numbers for JSON and derives the two fields every list
   * screen needs. Generic so the caller's own selected fields survive the mapping.
   */
  private toView<
    T extends {
      price: Prisma.Decimal;
      salePrice: Prisma.Decimal | null;
      costPrice: Prisma.Decimal | null;
      stock: number;
      reservedStock: number;
      trackInventory: boolean;
      lowStockThreshold: number;
      _count: { variants: number };
    },
  >(product: T) {
    const { _count, ...rest } = product;

    return {
      ...rest,
      price: Number(product.price),
      salePrice: this.toNumber(product.salePrice),
      costPrice: this.toNumber(product.costPrice),
      availableStock: product.stock - product.reservedStock,
      isLowStock: product.trackInventory && product.stock <= product.lowStockThreshold,
      variantsCount: _count.variants,
    };
  }

  private requireCompanyId(): string {
    const companyId = this.context.getCompanyId();
    if (!companyId) {
      throw new BadRequestAppException(
        'لا توجد شركة في سياق الطلب',
        ERROR_CODE.TENANT_CONTEXT_MISSING,
      );
    }
    return companyId;
  }
}
