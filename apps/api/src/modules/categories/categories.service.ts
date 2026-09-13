import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { randomSuffix, slugify } from '@common/utils/slug.util';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { QueryCategoriesDto } from './dto/query-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  imageUrl: true,
  parentId: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  // Filtered counts: a category whose products are all soft-deleted must still be
  // deletable, so deleted rows must not count towards the guard below.
  _count: {
    select: {
      products: { where: { deletedAt: null } },
      children: { where: { deletedAt: null } },
    },
  },
} as const satisfies Prisma.CategorySelect;

type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

export interface CategoryView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  productsCount: number;
  childrenCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryTreeNode extends CategoryView {
  children: CategoryTreeNode[];
}

/** Depth cap: a merchant catalog never legitimately nests deeper, and the limit keeps
 *  cycle checks and tree rendering bounded. */
const MAX_DEPTH = 4;

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly context: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: QueryCategoriesDto): Promise<CategoryView[] | CategoryTreeNode[]> {
    const where: Prisma.CategoryWhereInput = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const rows = await this.db.category.findMany({
      where,
      select: CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const views = rows.map((row) => this.toView(row));

    return query.tree ? this.buildTree(views) : views;
  }

  async findOne(id: string): Promise<CategoryView> {
    const category = await this.db.category.findFirst({
      where: { id, deletedAt: null },
      select: CATEGORY_SELECT,
    });

    if (!category) {
      throw new NotFoundAppException('التصنيف غير موجود');
    }

    return this.toView(category);
  }

  async create(dto: CreateCategoryDto): Promise<CategoryView> {
    if (dto.parentId) {
      await this.assertParentUsable(dto.parentId);
    }

    const category = await this.db.category.create({
      data: {
        companyId: this.requireCompanyId(),
        name: dto.name,
        slug: await this.generateUniqueSlug(dto.name),
        parentId: dto.parentId ?? null,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
      select: CATEGORY_SELECT,
    });

    await this.audit.record({
      action: AUDIT_ACTION.CREATE,
      entity: AUDIT_ENTITY.CATEGORY,
      entityId: category.id,
      newValue: this.toView(category),
    });

    return this.toView(category);
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryView> {
    const before = await this.findOne(id);

    if (dto.parentId !== undefined && dto.parentId !== before.parentId) {
      if (dto.parentId) {
        await this.assertParentUsable(dto.parentId);
        await this.assertNoCycle(id, dto.parentId);
      }
    }

    const category = await this.db.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId || null } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: CATEGORY_SELECT,
    });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.CATEGORY,
      entityId: id,
      oldValue: before,
      newValue: this.toView(category),
    });

    return this.toView(category);
  }

  /**
   * Soft delete. Refused while the category still holds products or child categories:
   * silently orphaning them would make products unreachable from the catalog tree.
   */
  async remove(id: string): Promise<void> {
    const category = await this.findOne(id);

    if (category.productsCount > 0) {
      throw new ConflictAppException(
        `لا يمكن حذف تصنيف يحتوي على ${category.productsCount} منتج، انقل المنتجات إلى تصنيف آخر أولاً`,
        ERROR_CODE.CONFLICT,
      );
    }

    if (category.childrenCount > 0) {
      throw new ConflictAppException(
        'لا يمكن حذف تصنيف يحتوي على تصنيفات فرعية، احذف الفرعية أولاً',
        ERROR_CODE.CONFLICT,
      );
    }

    const deletedAt = new Date();

    // The slug is released so the same name can be reused later.
    await this.db.category.update({
      where: { id },
      data: { deletedAt, isActive: false, slug: `${category.slug}.deleted.${deletedAt.getTime()}` },
    });

    await this.audit.record({
      action: AUDIT_ACTION.DELETE,
      entity: AUDIT_ENTITY.CATEGORY,
      entityId: id,
      oldValue: category,
    });
  }

  private async assertParentUsable(parentId: string): Promise<void> {
    const parent = await this.db.category.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { id: true, parentId: true },
    });

    if (!parent) {
      throw new BadRequestAppException('التصنيف الأب غير موجود');
    }

    if ((await this.depthOf(parent.id)) + 1 >= MAX_DEPTH) {
      throw new BadRequestAppException(`لا يمكن تجاوز ${MAX_DEPTH} مستويات في شجرة التصنيفات`);
    }
  }

  /** Walks ancestors to reject a move that would make a category its own descendant. */
  private async assertNoCycle(categoryId: string, newParentId: string): Promise<void> {
    let cursor: string | null = newParentId;

    for (let step = 0; step <= MAX_DEPTH && cursor; step += 1) {
      if (cursor === categoryId) {
        throw new BadRequestAppException('لا يمكن جعل التصنيف تابعاً لأحد فروعه');
      }
      const parent: { parentId: string | null } | null = await this.db.category.findFirst({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  private async depthOf(categoryId: string): Promise<number> {
    let depth = 0;
    let cursor: string | null = categoryId;

    while (cursor && depth <= MAX_DEPTH) {
      const parent: { parentId: string | null } | null = await this.db.category.findFirst({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
      if (cursor) depth += 1;
    }

    return depth;
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

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'category';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
      const existing = await this.db.category.findFirst({
        where: { slug: candidate, companyId: this.context.getCompanyId() },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }

    return `${base}-${Date.now().toString(36)}`;
  }

  private buildTree(views: CategoryView[]): CategoryTreeNode[] {
    const nodes = new Map<string, CategoryTreeNode>(
      views.map((view) => [view.id, { ...view, children: [] }]),
    );
    const roots: CategoryTreeNode[] = [];

    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        // A child whose parent is filtered out still surfaces, instead of disappearing.
        roots.push(node);
      }
    }

    return roots;
  }

  private toView(row: CategoryRow): CategoryView {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageUrl: row.imageUrl,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      productsCount: row._count.products,
      childrenCount: row._count.children,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
