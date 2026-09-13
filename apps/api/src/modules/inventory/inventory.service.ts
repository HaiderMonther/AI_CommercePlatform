import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { AdjustStockDto, MANUAL_MOVEMENT_TYPES } from './dto/adjust-stock.dto';
import { QueryMovementsDto } from './dto/query-movements.dto';
import { MOVEMENT_EFFECT, RecordMovementInput } from './inventory.types';

interface StockRow {
  stock: number;
  reservedStock: number;
  trackInventory: boolean;
}

export interface MovementResult {
  movementId: string;
  productId: string;
  variantId: string | null;
  stockBefore: number;
  stockAfter: number;
}

/**
 * The single writer of stock.
 *
 * No other service updates `stock` or `reservedStock` directly: every change goes
 * through `recordMovement`, which locks the row, validates the resulting quantity and
 * writes an InventoryMovement in the same transaction. That is what makes the current
 * stock reconstructable from its history, and what stops the AI and a human agent from
 * selling the same last piece concurrently.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Applies one stock movement atomically.
   *
   * Pass `tx` to join a caller's transaction (order creation reserves and sells stock
   * inside its own transaction, so a failed order never leaves stock consumed).
   */
  async recordMovement(
    input: RecordMovementInput,
    tx?: Prisma.TransactionClient,
  ): Promise<MovementResult> {
    const companyId = this.requireCompanyId();

    if (tx) {
      return this.applyMovement(tx, companyId, input);
    }

    return this.prisma.$transaction((client) => this.applyMovement(client, companyId, input));
  }

  private async applyMovement(
    tx: Prisma.TransactionClient,
    companyId: string,
    input: RecordMovementInput,
  ): Promise<MovementResult> {
    if (input.quantity < 0) {
      throw new BadRequestAppException('الكمية يجب أن تكون صفراً أو أكثر');
    }

    const current = await this.lockRow(tx, companyId, input.productId, input.variantId ?? null);

    if (!current.trackInventory) {
      throw new BadRequestAppException('هذا المنتج غير خاضع لتتبع المخزون');
    }

    const { stockDelta, reservedDelta } = this.computeDeltas(input, current);

    const stockAfter = current.stock + stockDelta;
    const reservedAfter = current.reservedStock + reservedDelta;

    if (stockAfter < 0) {
      throw new ConflictAppException(
        `الكمية المتوفرة غير كافية. المتوفر: ${current.stock}`,
        ERROR_CODE.INSUFFICIENT_STOCK,
      );
    }

    if (reservedAfter < 0) {
      throw new ConflictAppException(
        `لا يمكن فك حجز أكثر من المحجوز فعلياً. المحجوز: ${current.reservedStock}`,
        ERROR_CODE.INSUFFICIENT_STOCK,
      );
    }

    // Reserving beyond what is on hand would promise stock that does not exist.
    if (reservedAfter > stockAfter) {
      throw new ConflictAppException(
        `الكمية المتاحة للحجز غير كافية. المتاح: ${current.stock - current.reservedStock}`,
        ERROR_CODE.INSUFFICIENT_STOCK,
      );
    }

    await this.writeQuantities(tx, companyId, input, stockAfter, reservedAfter);

    const movement = await tx.inventoryMovement.create({
      data: {
        companyId,
        productId: input.productId,
        variantId: input.variantId ?? null,
        type: input.type,
        // Stored as the signed change so a movement reads the same way as the ledger.
        quantity: stockDelta !== 0 ? stockDelta : reservedDelta,
        quantityBefore: current.stock,
        quantityAfter: stockAfter,
        unitCost: input.unitCost ?? null,
        reason: input.reason ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        userId: this.context.getUserId() ?? null,
      },
      select: { id: true },
    });

    return {
      movementId: movement.id,
      productId: input.productId,
      variantId: input.variantId ?? null,
      stockBefore: current.stock,
      stockAfter,
    };
  }

  /**
   * Locks the rows this movement will touch, for the rest of the transaction.
   *
   * The parent product is always locked first, even for a variant movement. Two reasons:
   * the parent's totals are recomputed from its variants afterwards, and without holding
   * the parent lock two concurrent variant movements both recompute from data the other
   * has not committed yet — the second write then silently loses the first. Locking the
   * parent first also gives every caller the same lock order, so movements queue instead
   * of deadlocking.
   */
  private async lockRow(
    tx: Prisma.TransactionClient,
    companyId: string,
    productId: string,
    variantId: string | null,
  ): Promise<StockRow> {
    const products = await tx.$queryRaw<
      { stock: number; reservedStock: number; trackInventory: boolean; hasVariants: boolean }[]
    >`
      SELECT stock, "reservedStock", "trackInventory", "hasVariants"
      FROM products
      WHERE id = ${productId}
        AND "companyId" = ${companyId}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;

    if (products.length === 0) {
      throw new NotFoundAppException('المنتج غير موجود', ERROR_CODE.PRODUCT_NOT_FOUND);
    }

    const product = products[0];

    if (!variantId) {
      if (product.hasVariants) {
        throw new BadRequestAppException(
          'هذا المنتج يحتوي على متغيرات، حدّد المتغير المطلوب تعديل مخزونه',
        );
      }
      return product;
    }

    const variants = await tx.$queryRaw<{ stock: number; reservedStock: number }[]>`
      SELECT stock, "reservedStock"
      FROM product_variants
      WHERE id = ${variantId}
        AND "productId" = ${productId}
        AND "companyId" = ${companyId}
        AND "deletedAt" IS NULL
      FOR UPDATE
    `;

    if (variants.length === 0) {
      throw new NotFoundAppException('المتغير غير موجود');
    }

    // Quantities come from the variant; whether stock is tracked is a product-level setting.
    return { ...variants[0], trackInventory: product.trackInventory };
  }

  private computeDeltas(
    input: RecordMovementInput,
    current: StockRow,
  ): { stockDelta: number; reservedDelta: number } {
    if (input.type === InventoryMovementType.ADJUSTMENT) {
      // The only type that sets an absolute value: a stock count corrects the record to
      // whatever was physically found on the shelf.
      const target = input.targetQuantity ?? input.quantity;
      return { stockDelta: target - current.stock, reservedDelta: 0 };
    }

    const effect = MOVEMENT_EFFECT[input.type];
    return {
      stockDelta: effect.stock * input.quantity,
      reservedDelta: effect.reserved * input.quantity,
    };
  }

  /**
   * Writes the new quantities. For a variant, the parent product's totals are recomputed
   * from its variants rather than incremented, so the aggregate can never drift.
   */
  private async writeQuantities(
    tx: Prisma.TransactionClient,
    companyId: string,
    input: RecordMovementInput,
    stockAfter: number,
    reservedAfter: number,
  ): Promise<void> {
    if (input.variantId) {
      await tx.productVariant.update({
        where: { id: input.variantId },
        data: { stock: stockAfter, reservedStock: reservedAfter },
      });

      await tx.$executeRaw`
        UPDATE products p
        SET stock = COALESCE(agg.total_stock, 0),
            "reservedStock" = COALESCE(agg.total_reserved, 0),
            "updatedAt" = NOW()
        FROM (
          SELECT COALESCE(SUM(stock), 0) AS total_stock,
                 COALESCE(SUM("reservedStock"), 0) AS total_reserved
          FROM product_variants
          WHERE "productId" = ${input.productId} AND "deletedAt" IS NULL
        ) agg
        WHERE p.id = ${input.productId} AND p."companyId" = ${companyId}
      `;
      return;
    }

    await tx.product.update({
      where: { id: input.productId },
      data: { stock: stockAfter, reservedStock: reservedAfter },
    });
  }

  /** Operator-triggered stock change from the dashboard. */
  async adjust(dto: AdjustStockDto): Promise<MovementResult> {
    if (!MANUAL_MOVEMENT_TYPES.includes(dto.type)) {
      throw new BadRequestAppException('نوع الحركة غير مسموح يدوياً');
    }

    const result = await this.recordMovement({
      productId: dto.productId,
      variantId: dto.variantId ?? null,
      type: dto.type,
      quantity: dto.quantity,
      targetQuantity: dto.type === InventoryMovementType.ADJUSTMENT ? dto.quantity : undefined,
      reason: dto.reason ?? null,
      referenceType: 'Manual',
    });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.INVENTORY,
      entityId: dto.variantId ?? dto.productId,
      oldValue: { stock: result.stockBefore },
      newValue: { stock: result.stockAfter, type: dto.type, reason: dto.reason },
    });

    this.logger.log(
      `Stock ${dto.type} on ${dto.variantId ?? dto.productId}: ${result.stockBefore} → ${result.stockAfter}`,
    );

    return result;
  }

  async findMovements(query: QueryMovementsDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.InventoryMovementWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: query.sortOrder },
        skip: query.skip,
        take: query.limit,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          variant: { select: { id: true, name: true, sku: true } },
          user: { select: { id: true, fullName: true } },
        },
      }),
      this.db.inventoryMovement.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  /** Products at or below their low-stock threshold — the restocking worklist. */
  async findLowStock(limit = 50) {
    const companyId = this.requireCompanyId();

    return this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        sku: string;
        stock: number;
        reservedStock: number;
        lowStockThreshold: number;
      }[]
    >`
      SELECT id, name, sku, stock, "reservedStock", "lowStockThreshold"
      FROM products
      WHERE "companyId" = ${companyId}
        AND "deletedAt" IS NULL
        AND "isActive" = true
        AND "trackInventory" = true
        AND stock <= "lowStockThreshold"
      ORDER BY (stock - "lowStockThreshold") ASC, name ASC
      LIMIT ${limit}
    `;
  }

  async getSummary() {
    const companyId = this.requireCompanyId();

    const [row] = await this.prisma.$queryRaw<
      {
        totalProducts: bigint;
        totalUnits: bigint;
        reservedUnits: bigint;
        lowStockCount: bigint;
        outOfStockCount: bigint;
        stockValue: string | null;
      }[]
    >`
      SELECT COUNT(*)::bigint AS "totalProducts",
             COALESCE(SUM(stock), 0)::bigint AS "totalUnits",
             COALESCE(SUM("reservedStock"), 0)::bigint AS "reservedUnits",
             COUNT(*) FILTER (WHERE stock <= "lowStockThreshold" AND stock > 0)::bigint AS "lowStockCount",
             COUNT(*) FILTER (WHERE stock = 0)::bigint AS "outOfStockCount",
             COALESCE(SUM(stock * COALESCE("costPrice", 0)), 0)::text AS "stockValue"
      FROM products
      WHERE "companyId" = ${companyId}
        AND "deletedAt" IS NULL
        AND "trackInventory" = true
    `;

    return {
      totalProducts: Number(row.totalProducts),
      totalUnits: Number(row.totalUnits),
      reservedUnits: Number(row.reservedUnits),
      availableUnits: Number(row.totalUnits) - Number(row.reservedUnits),
      lowStockCount: Number(row.lowStockCount),
      outOfStockCount: Number(row.outOfStockCount),
      stockValue: row.stockValue ?? '0',
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
