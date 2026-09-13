import { Inject, Injectable } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';

const VARIANT_SELECT = {
  id: true,
  productId: true,
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
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class VariantsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly context: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async findAll(productId: string) {
    await this.assertProductExists(productId);

    const variants = await this.db.productVariant.findMany({
      where: { productId, deletedAt: null },
      select: VARIANT_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    return variants.map((variant) => this.toView(variant));
  }

  /**
   * Adds a variant. The first one flips the product to `hasVariants`, after which the
   * product's own stock becomes the sum of its variants and is no longer adjusted
   * directly — otherwise the parent total and the variant totals would drift apart.
   */
  async create(productId: string, dto: CreateVariantDto) {
    const companyId = this.requireCompanyId();
    const product = await this.assertProductExists(productId);

    this.assertAttributes(dto.attributes);
    await this.assertAttributesUnique(productId, dto.attributes);

    const name = dto.name ?? this.deriveName(dto.attributes);
    const sku = await this.resolveSku(dto.sku, product.sku, dto.attributes);

    const variantId = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          companyId,
          productId,
          sku,
          name,
          attributes: dto.attributes as Prisma.InputJsonValue,
          price: dto.price !== undefined ? new Prisma.Decimal(dto.price) : null,
          salePrice: dto.salePrice !== undefined ? new Prisma.Decimal(dto.salePrice) : null,
          costPrice: dto.costPrice !== undefined ? new Prisma.Decimal(dto.costPrice) : null,
          stock: 0,
          imageUrl: dto.imageUrl ?? null,
          isActive: dto.isActive ?? true,
        },
        select: { id: true },
      });

      if (!product.hasVariants) {
        // Stock recorded against the product before it had variants would become
        // unattributable, so it is moved out as an explicit, auditable movement.
        if (product.stock > 0) {
          await this.inventory.recordMovement(
            {
              productId,
              type: InventoryMovementType.STOCK_OUT,
              quantity: product.stock,
              reason: 'نقل المخزون إلى المتغيرات عند إضافة أول متغير',
              referenceType: 'Manual',
            },
            tx,
          );
        }

        await tx.product.update({ where: { id: productId }, data: { hasVariants: true } });
      }

      if (dto.initialStock && dto.initialStock > 0) {
        await this.inventory.recordMovement(
          {
            productId,
            variantId: variant.id,
            type: InventoryMovementType.STOCK_IN,
            quantity: dto.initialStock,
            unitCost: dto.costPrice ?? null,
            reason: 'الكمية الابتدائية عند إنشاء المتغير',
            referenceType: 'Manual',
          },
          tx,
        );
      }

      return variant.id;
    });

    const created = await this.findOne(productId, variantId);

    await this.audit.record({
      action: AUDIT_ACTION.CREATE,
      entity: AUDIT_ENTITY.PRODUCT,
      entityId: variantId,
      newValue: { variant: created, productId },
    });

    return created;
  }

  async findOne(productId: string, variantId: string) {
    const variant = await this.db.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
      select: VARIANT_SELECT,
    });

    if (!variant) {
      throw new NotFoundAppException('المتغير غير موجود');
    }

    return this.toView(variant);
  }

  async update(productId: string, variantId: string, dto: UpdateVariantDto) {
    const before = await this.findOne(productId, variantId);

    if (dto.attributes) {
      this.assertAttributes(dto.attributes);
      await this.assertAttributesUnique(productId, dto.attributes, variantId);
    }

    await this.db.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.attributes !== undefined
          ? {
              attributes: dto.attributes as Prisma.InputJsonValue,
              name: dto.name ?? this.deriveName(dto.attributes),
            }
          : dto.name !== undefined
            ? { name: dto.name }
            : {}),
        ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
        ...(dto.salePrice !== undefined ? { salePrice: new Prisma.Decimal(dto.salePrice) } : {}),
        ...(dto.costPrice !== undefined ? { costPrice: new Prisma.Decimal(dto.costPrice) } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    const updated = await this.findOne(productId, variantId);

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.PRODUCT,
      entityId: variantId,
      oldValue: before,
      newValue: updated,
    });

    return updated;
  }

  async remove(productId: string, variantId: string): Promise<void> {
    const variant = await this.findOne(productId, variantId);

    if (variant.reservedStock > 0) {
      throw new ConflictAppException(
        'لا يمكن حذف متغير لديه كمية محجوزة ضمن طلبات غير مكتملة',
        ERROR_CODE.CONFLICT,
      );
    }

    const deletedAt = new Date();
    const companyId = this.requireCompanyId();

    await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variantId },
        data: { deletedAt, isActive: false, sku: `${variant.sku}.deleted.${deletedAt.getTime()}` },
      });

      // Recompute the parent total so the removed variant's stock stops counting.
      await tx.$executeRaw`
        UPDATE products p
        SET stock = COALESCE(agg.total_stock, 0),
            "reservedStock" = COALESCE(agg.total_reserved, 0),
            "hasVariants" = agg.variant_count > 0,
            "updatedAt" = NOW()
        FROM (
          SELECT COALESCE(SUM(stock), 0) AS total_stock,
                 COALESCE(SUM("reservedStock"), 0) AS total_reserved,
                 COUNT(*) AS variant_count
          FROM product_variants
          WHERE "productId" = ${productId} AND "deletedAt" IS NULL
        ) agg
        WHERE p.id = ${productId} AND p."companyId" = ${companyId}
      `;
    });

    await this.audit.record({
      action: AUDIT_ACTION.DELETE,
      entity: AUDIT_ENTITY.PRODUCT,
      entityId: variantId,
      oldValue: variant,
    });
  }

  private async assertProductExists(productId: string) {
    const product = await this.db.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, sku: true, stock: true, hasVariants: true },
    });

    if (!product) {
      throw new NotFoundAppException('المنتج غير موجود', ERROR_CODE.PRODUCT_NOT_FOUND);
    }

    return product;
  }

  private assertAttributes(attributes: Record<string, string>): void {
    const entries = Object.entries(attributes);

    if (entries.length === 0) {
      throw new BadRequestAppException('يجب تحديد خاصية واحدة على الأقل للمتغير مثل اللون أو المقاس');
    }

    if (entries.length > 5) {
      throw new BadRequestAppException('لا يمكن تجاوز 5 خصائص للمتغير الواحد');
    }

    for (const [key, value] of entries) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestAppException(`قيمة الخاصية "${key}" غير صالحة`);
      }
      if (value.length > 60) {
        throw new BadRequestAppException(`قيمة الخاصية "${key}" طويلة جداً`);
      }
    }
  }

  /** Two variants of the same product must not describe the same combination. */
  private async assertAttributesUnique(
    productId: string,
    attributes: Record<string, string>,
    excludeVariantId?: string,
  ): Promise<void> {
    const siblings = await this.db.productVariant.findMany({
      where: {
        productId,
        deletedAt: null,
        ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
      },
      select: { attributes: true },
    });

    const fingerprint = this.fingerprint(attributes);

    const duplicate = siblings.some(
      (sibling) => this.fingerprint(sibling.attributes as Record<string, string>) === fingerprint,
    );

    if (duplicate) {
      throw new ConflictAppException('يوجد متغير بنفس الخصائص لهذا المنتج');
    }
  }

  private fingerprint(attributes: Record<string, string>): string {
    return Object.entries(attributes)
      .map(([key, value]) => [key.trim().toLowerCase(), String(value).trim().toLowerCase()])
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('|');
  }

  private deriveName(attributes: Record<string, string>): string {
    return Object.values(attributes)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join(' / ');
  }

  private async resolveSku(
    requested: string | undefined,
    productSku: string,
    attributes: Record<string, string>,
  ): Promise<string> {
    if (requested) {
      const existing = await this.db.productVariant.findFirst({
        where: { sku: requested, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictAppException('رمز المتغير مستخدم مسبقاً', ERROR_CODE.SKU_ALREADY_USED);
      }
      return requested;
    }

    const suffix =
      Object.values(attributes)
        .map((value) =>
          String(value)
            .trim()
            .replace(/\s+/g, '')
            .slice(0, 4)
            .toUpperCase(),
        )
        .join('-') || 'VAR';

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = `${productSku}-${suffix}${attempt > 0 ? `-${attempt}` : ''}`.slice(0, 60);
      const existing = await this.db.productVariant.findFirst({
        where: { sku: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }

    return `${productSku}-${Date.now().toString(36).toUpperCase()}`.slice(0, 60);
  }

  private toView(variant: Prisma.ProductVariantGetPayload<{ select: typeof VARIANT_SELECT }>) {
    return {
      ...variant,
      price: variant.price === null ? null : Number(variant.price),
      salePrice: variant.salePrice === null ? null : Number(variant.salePrice),
      costPrice: variant.costPrice === null ? null : Number(variant.costPrice),
      availableStock: variant.stock - variant.reservedStock,
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
