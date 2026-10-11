import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CustomerStatus,
  InventoryMovementType,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { PaginatedResult, paginate } from '@common/dto/pagination.dto';
import {
  AppException,
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { toLatinDigits } from '@common/utils/phone.util';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { MOVEMENT_REFERENCE } from '@modules/inventory/inventory.types';
import { RealtimeService } from '@modules/realtime/realtime.service';
import {
  CreateOrderDto,
  OrderItemInputDto,
  QueryOrdersDto,
  ReplaceOrderItemsDto,
  UpdateOrderDto,
  UpdateOrderPaymentDto,
  UpdateOrderStatusDto,
} from './dto/order.dto';
import { PricedLine, effectiveUnitPrice, orderTotals, priceLine, toMoney } from './order-pricing';
import {
  ITEMS_EDITABLE_STATUSES,
  MANUAL_DELIVERY_STATUSES,
  OPEN_ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  OrderState,
  PRICING_EDITABLE_STATUSES,
  canTransition,
  paymentStatusOf,
  statusPatch,
  stockStageOf,
} from './order.rules';
import {
  PlannedMovement,
  StockHolding,
  holdingKey,
  reservationDiff,
  stageMovements,
} from './order-stock';

type Tx = Prisma.TransactionClient;

/** Order numbers start above this, so the first order a shop sends reads #1001. */
const ORDER_NUMBER_BASE = 1000;

/** Interactive transactions that lock several stock rows need more than Prisma's 5s default. */
const TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 };

const ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  deliveryStatus: true,
  paymentMethod: true,
  source: true,
  currency: true,
  subtotal: true,
  discount: true,
  deliveryFee: true,
  total: true,
  paidAmount: true,
  customerId: true,
  conversationId: true,
  customerName: true,
  customerPhone: true,
  deliveryCity: true,
  createdAt: true,
  updatedAt: true,
  createdByUser: { select: { id: true, fullName: true } },
  _count: { select: { items: true } },
} as const satisfies Prisma.OrderSelect;

const ORDER_DETAIL_SELECT = {
  ...ORDER_LIST_SELECT,
  deliveryAddress: true,
  notes: true,
  confirmedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancelReason: true,
  customer: {
    select: { id: true, name: true, phone: true, city: true, status: true, deletedAt: true },
  },
  conversation: { select: { id: true, channel: true, status: true } },
  items: {
    select: {
      id: true,
      productId: true,
      variantId: true,
      productName: true,
      variantName: true,
      sku: true,
      quantity: true,
      unitPrice: true,
      discount: true,
      total: true,
      product: {
        select: {
          images: {
            select: { url: true },
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            take: 1,
          },
        },
      },
    },
    // Lines of one order share a createdAt; the id keeps their entry order stable.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  statusHistory: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      user: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.OrderSelect;

type OrderListRow = Prisma.OrderGetPayload<{ select: typeof ORDER_LIST_SELECT }>;
type OrderDetailRow = Prisma.OrderGetPayload<{ select: typeof ORDER_DETAIL_SELECT }>;

/** A requested line, checked against the catalog and priced. */
interface ResolvedLine extends PricedLine {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  trackInventory: boolean;
}

interface LockedOrder extends OrderState {
  id: string;
  orderNumber: number;
  customerId: string;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * Orders and their lifecycle.
 *
 * Stock follows the order through the inventory ledger: placing an order reserves its
 * lines, shipping (or handing over) turns the reservation into a sale, and cancelling
 * releases the reservation or books the goods back in. What an order currently holds is
 * read from its own ledger entries, never inferred from its lines, so the two cannot drift.
 *
 * Every write locks the order row first, so two agents pressing "cancel" at once release
 * the stock once.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------------

  async findAll(query: QueryOrdersDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.OrderWhereInput = {
      ...(query.status
        ? { status: query.status }
        : query.open
          ? { status: { in: OPEN_ORDER_STATUSES } }
          : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.deliveryStatus ? { deliveryStatus: query.deliveryStatus } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.conversationId ? { conversationId: query.conversationId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search ? { OR: this.searchFilter(query.search) } : {}),
    };

    const [items, total] = await Promise.all([
      this.db.order.findMany({
        where,
        select: ORDER_LIST_SELECT,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { orderNumber: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.db.order.count({ where }),
    ]);

    return paginate(items.map((row) => this.toListView(row)), total, query.page, query.limit);
  }

  /** Counters for the status tabs. */
  async stats() {
    const rows = await this.db.order.groupBy({ by: ['status'], _count: { _all: true } });

    const byStatus = Object.fromEntries(
      Object.values(OrderStatus).map((status) => [
        status,
        rows.find((row) => row.status === status)?._count._all ?? 0,
      ]),
    ) as Record<OrderStatus, number>;

    return {
      byStatus,
      open: OPEN_ORDER_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    };
  }

  async findOne(id: string) {
    const order = await this.db.order.findFirst({ where: { id }, select: ORDER_DETAIL_SELECT });

    if (!order) {
      throw this.notFound();
    }

    return this.toDetailView(order);
  }

  // ---------------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------------

  /**
   * Places an order and reserves its stock in one transaction: if any line is out of
   * stock nothing is written, not even a customer created on the fly.
   *
   * `source` is DASHBOARD from the API; the AI agent (Phase 6) passes AI.
   */
  async create(dto: CreateOrderDto, source: OrderSource = OrderSource.DASHBOARD) {
    const companyId = this.requireCompanyId();
    const userId = this.context.getUserId() ?? null;

    const lines = await this.resolveLines(dto.items);
    const totals = orderTotals(lines, toMoney(dto.discount), toMoney(dto.deliveryFee));

    let created: { id: string; orderNumber: number };

    try {
      created = await this.prisma.$transaction(async (tx) => {
        const customer = await this.resolveCustomer(tx, companyId, dto);

        if (dto.conversationId) {
          await this.assertConversationOf(tx, companyId, dto.conversationId, customer.id);
        }

        const customerPhone = dto.customerPhone ?? customer.phone;
        if (!customerPhone) {
          throw new BadRequestAppException('رقم هاتف الزبون مطلوب لتوصيل الطلب');
        }

        const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
          select: { currency: true },
        });

        const orderNumber = await this.nextOrderNumber(tx, companyId);

        const order = await tx.order.create({
          data: {
            companyId,
            orderNumber,
            customerId: customer.id,
            conversationId: dto.conversationId ?? null,
            source,
            status: OrderStatus.NEW,
            paymentMethod: dto.paymentMethod ?? PaymentMethod.CASH_ON_DELIVERY,
            currency: company.currency,
            subtotal: totals.subtotal,
            discount: totals.discount,
            deliveryFee: totals.deliveryFee,
            total: totals.total,
            customerName: dto.customerName ?? customer.name,
            customerPhone,
            deliveryAddress: dto.deliveryAddress ?? customer.address,
            deliveryCity: dto.deliveryCity ?? customer.city,
            notes: dto.notes?.trim() || null,
            createdByUserId: userId,
            items: { createMany: { data: lines.map((line) => this.itemData(companyId, line)) } },
            statusHistory: {
              create: { companyId, fromStatus: null, toStatus: OrderStatus.NEW, userId },
            },
          },
          select: { id: true, orderNumber: true },
        });

        await this.applyMovements(tx, order, reservationDiff([], this.requiredStock(lines)), lines);
        await this.recomputeCustomer(tx, companyId, customer.id);

        return order;
      }, TX_OPTIONS);
    } catch (error) {
      // A racing write on the same new customer phone; the lock serializes order numbers.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictAppException(
          'تعذّر إنشاء الطلب بسبب تعديل متزامن، أعد المحاولة',
          ERROR_CODE.ORDER_CREATE_FAILED,
        );
      }
      throw error;
    }

    const view = await this.findOne(created.id);

    await this.audit.record({
      action: AUDIT_ACTION.CREATE,
      entity: AUDIT_ENTITY.ORDER,
      entityId: created.id,
      newValue: view,
    });

    this.logger.log(`Order #${created.orderNumber} placed (${source}) with ${lines.length} line(s)`);
    await this.publish(created.id);
    return view;
  }

  // ---------------------------------------------------------------------------------
  // Changes
  // ---------------------------------------------------------------------------------

  async updateStatus(id: string, dto: UpdateOrderStatusDto) {
    const companyId = this.requireCompanyId();
    const userId = this.context.getUserId() ?? null;
    const to = dto.status;

    const from = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, companyId, id);

      if (order.status === to) {
        throw new BadRequestAppException(`الطلب ${ORDER_STATUS_LABELS[to]} مسبقاً`);
      }

      if (!canTransition(order.status, to)) {
        throw new ConflictAppException(
          `لا يمكن نقل الطلب من «${ORDER_STATUS_LABELS[order.status]}» إلى «${ORDER_STATUS_LABELS[to]}»`,
          ERROR_CODE.ORDER_INVALID_TRANSITION,
          { from: order.status, to, allowed: ORDER_TRANSITIONS[order.status] },
        );
      }

      const holdings = await this.holdingsOf(tx, companyId, id);
      const movements = stageMovements(holdings, stockStageOf(order.status), stockStageOf(to));
      await this.applyMovements(tx, order, movements);

      await tx.order.update({
        where: { id },
        data: statusPatch(order, to, new Date(), dto.cancelReason),
      });

      await tx.orderStatusHistory.create({
        data: {
          companyId,
          orderId: id,
          fromStatus: order.status,
          toStatus: to,
          note: dto.note || (to === OrderStatus.CANCELLED ? dto.cancelReason : null) || null,
          userId,
        },
      });

      await this.recomputeCustomer(tx, companyId, order.customerId);
      return order.status;
    }, TX_OPTIONS);

    await this.audit.record({
      action: AUDIT_ACTION.STATUS_CHANGE,
      entity: AUDIT_ENTITY.ORDER,
      entityId: id,
      oldValue: { status: from },
      newValue: { status: to, note: dto.note ?? null, cancelReason: dto.cancelReason ?? null },
    });

    return this.reloadAndPublish(id);
  }

  /**
   * Records how much has been collected so far. An absolute amount rather than a
   * "payment" so a mistyped figure is corrected by entering the right one.
   */
  async updatePayment(id: string, dto: UpdateOrderPaymentDto) {
    const companyId = this.requireCompanyId();
    const paidAmount = toMoney(dto.paidAmount);

    const before = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, companyId, id);

      if (order.status === OrderStatus.CANCELLED) {
        throw new ConflictAppException(
          'لا يمكن تسجيل دفعة على طلب ملغى',
          ERROR_CODE.ORDER_NOT_EDITABLE,
        );
      }

      if (paidAmount.gt(order.total)) {
        throw new BadRequestAppException('المبلغ المدفوع أكبر من إجمالي الطلب');
      }

      await tx.order.update({
        where: { id },
        data: {
          paidAmount,
          paymentStatus: paymentStatusOf(paidAmount, order.total),
          ...(dto.paymentMethod ? { paymentMethod: dto.paymentMethod } : {}),
        },
      });

      await this.recomputeCustomer(tx, companyId, order.customerId);
      return order;
    }, TX_OPTIONS);

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.ORDER,
      entityId: id,
      oldValue: { paidAmount: Number(before.paidAmount) },
      newValue: { paidAmount: dto.paidAmount, paymentMethod: dto.paymentMethod ?? null },
    });

    return this.reloadAndPublish(id);
  }

  /** Delivery details, notes, discount and fee. Lines change through `replaceItems`. */
  async update(id: string, dto: UpdateOrderDto) {
    const companyId = this.requireCompanyId();

    const before = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, companyId, id);
      const open = OPEN_ORDER_STATUSES.includes(order.status);

      // Notes stay editable on a closed order; everything else describes a delivery
      // that has already happened or never will.
      const changesDelivery = Object.entries(dto).some(
        ([key, value]) => key !== 'notes' && value !== undefined,
      );
      if (!open && changesDelivery) {
        throw new ConflictAppException(
          'لا يمكن تعديل طلب مكتمل أو ملغى عدا الملاحظات',
          ERROR_CODE.ORDER_NOT_EDITABLE,
        );
      }

      const data: Prisma.OrderUncheckedUpdateInput = {
        ...(dto.customerName !== undefined ? { customerName: dto.customerName } : {}),
        ...(dto.customerPhone !== undefined ? { customerPhone: dto.customerPhone } : {}),
        ...(dto.deliveryAddress !== undefined ? { deliveryAddress: dto.deliveryAddress || null } : {}),
        ...(dto.deliveryCity !== undefined ? { deliveryCity: dto.deliveryCity || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod } : {}),
      };

      if (dto.deliveryStatus !== undefined) {
        if (!MANUAL_DELIVERY_STATUSES.includes(dto.deliveryStatus)) {
          throw new BadRequestAppException(
            'حالة التوصيل هذه تتبع حالة الطلب، غيّر حالة الطلب بدلاً منها',
          );
        }
        data.deliveryStatus = dto.deliveryStatus;
      }

      if (dto.discount !== undefined || dto.deliveryFee !== undefined) {
        if (!PRICING_EDITABLE_STATUSES.includes(order.status)) {
          throw new ConflictAppException(
            'لا يمكن تعديل الخصم أو أجور التوصيل بعد شحن الطلب',
            ERROR_CODE.ORDER_NOT_EDITABLE,
          );
        }

        Object.assign(
          data,
          this.repriced(
            order,
            order.subtotal,
            dto.discount !== undefined ? toMoney(dto.discount) : order.discount,
            dto.deliveryFee !== undefined ? toMoney(dto.deliveryFee) : order.deliveryFee,
          ),
        );
      }

      await tx.order.update({ where: { id }, data });
      return order;
    }, TX_OPTIONS);

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.ORDER,
      entityId: id,
      oldValue: {
        discount: Number(before.discount),
        deliveryFee: Number(before.deliveryFee),
        deliveryStatus: before.deliveryStatus,
      },
      newValue: dto,
    });

    return this.reloadAndPublish(id);
  }

  /**
   * Replaces the order's lines and moves only the difference in reserved stock. Allowed
   * until the order is being prepared — after that the goods are being packed.
   */
  async replaceItems(id: string, dto: ReplaceOrderItemsDto) {
    const companyId = this.requireCompanyId();
    const lines = await this.resolveLines(dto.items);

    const before = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, companyId, id);

      if (!ITEMS_EDITABLE_STATUSES.includes(order.status)) {
        throw new ConflictAppException(
          'لا يمكن تعديل منتجات الطلب بعد بدء تجهيزه',
          ERROR_CODE.ORDER_NOT_EDITABLE,
        );
      }

      const previousItems = await tx.orderItem.findMany({
        where: { orderId: id, companyId },
        select: { productName: true, variantName: true, quantity: true, total: true },
      });

      const subtotal = orderTotals(lines).subtotal;
      const pricing = this.repriced(order, subtotal, order.discount, order.deliveryFee);

      const holdings = await this.holdingsOf(tx, companyId, id);
      await this.applyMovements(tx, order, reservationDiff(holdings, this.requiredStock(lines)), lines);

      await tx.orderItem.deleteMany({ where: { orderId: id, companyId } });
      await tx.orderItem.createMany({
        data: lines.map((line) => ({ ...this.itemData(companyId, line), orderId: id })),
      });
      await tx.order.update({ where: { id }, data: pricing });

      return previousItems;
    }, TX_OPTIONS);

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.ORDER,
      entityId: id,
      oldValue: { items: before.map((item) => ({ ...item, total: Number(item.total) })) },
      newValue: {
        items: lines.map((line) => ({
          productName: line.productName,
          variantName: line.variantName,
          quantity: line.quantity,
          total: Number(line.total),
        })),
      },
    });

    return this.reloadAndPublish(id);
  }

  /**
   * Deletes a cancelled order. Live orders are cancelled instead, so their stock is
   * released through the lifecycle; the ledger keeps the order's movements either way.
   */
  async remove(id: string): Promise<void> {
    const companyId = this.requireCompanyId();

    const order = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOrder(tx, companyId, id);

      if (locked.status !== OrderStatus.CANCELLED) {
        throw new ConflictAppException(
          'لا يمكن حذف إلا الطلبات الملغاة، ألغِ الطلب أولاً',
          ERROR_CODE.ORDER_NOT_EDITABLE,
        );
      }

      await tx.order.delete({ where: { id } });
      await this.recomputeCustomer(tx, companyId, locked.customerId);
      return locked;
    }, TX_OPTIONS);

    await this.audit.record({
      action: AUDIT_ACTION.DELETE,
      entity: AUDIT_ENTITY.ORDER,
      entityId: id,
      oldValue: { orderNumber: order.orderNumber, total: Number(order.total) },
    });

    this.realtime.orderUpdated(companyId, { id, deleted: true });
  }

  // ---------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------

  /** Checks every requested line against the catalog and prices it. */
  private async resolveLines(items: OrderItemInputDto[]): Promise<ResolvedLine[]> {
    const productIds = [...new Set(items.map((item) => item.productId))];
    const variantIds = [...new Set(items.flatMap((item) => (item.variantId ? [item.variantId] : [])))];

    const products = await this.db.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        salePrice: true,
        isActive: true,
        hasVariants: true,
        trackInventory: true,
        variants: {
          where: { id: { in: variantIds }, deletedAt: null },
          select: { id: true, name: true, sku: true, price: true, salePrice: true, isActive: true },
        },
      },
    });

    const byId = new Map(products.map((product) => [product.id, product]));

    return items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) {
        throw new NotFoundAppException('أحد المنتجات المطلوبة غير موجود', ERROR_CODE.PRODUCT_NOT_FOUND);
      }
      if (!product.isActive) {
        throw new BadRequestAppException(
          `المنتج «${product.name}» غير متاح للبيع حالياً`,
          ERROR_CODE.PRODUCT_UNAVAILABLE,
        );
      }

      if (product.hasVariants && !item.variantId) {
        throw new BadRequestAppException(`حدّد اللون أو المقاس للمنتج «${product.name}»`);
      }
      if (!product.hasVariants && item.variantId) {
        throw new BadRequestAppException(`المنتج «${product.name}» ليس له متغيرات`);
      }

      const variant = item.variantId
        ? product.variants.find((candidate) => candidate.id === item.variantId)
        : null;

      if (item.variantId && !variant) {
        throw new NotFoundAppException(`المتغير المطلوب من «${product.name}» غير موجود`);
      }
      if (variant && !variant.isActive) {
        throw new BadRequestAppException(
          `«${product.name} - ${variant.name}» غير متاح للبيع حالياً`,
          ERROR_CODE.PRODUCT_UNAVAILABLE,
        );
      }

      const priced = priceLine({
        quantity: item.quantity,
        unitPrice:
          item.unitPrice !== undefined ? toMoney(item.unitPrice) : effectiveUnitPrice(product, variant),
        discount: toMoney(item.discount),
      });

      return {
        ...priced,
        productId: product.id,
        variantId: variant?.id ?? null,
        productName: product.name,
        variantName: variant?.name ?? null,
        sku: variant?.sku ?? product.sku,
        trackInventory: product.trackInventory,
      };
    });
  }

  /** Units each tracked product (or variant) must have reserved for these lines. */
  private requiredStock(lines: ResolvedLine[]) {
    const required = new Map<string, { productId: string; variantId: string | null; quantity: number }>();

    for (const line of lines) {
      if (!line.trackInventory) continue;
      const key = holdingKey(line.productId, line.variantId);
      const current = required.get(key);
      required.set(key, {
        productId: line.productId,
        variantId: line.variantId,
        quantity: (current?.quantity ?? 0) + line.quantity,
      });
    }

    return required;
  }

  /**
   * Books stock movements for an order through the single stock writer, joining the
   * caller's transaction.
   *
   * A reservation that cannot be met fails the whole operation with the product's name.
   * Releasing or returning stock for a product that has since been deleted or stopped
   * being tracked is skipped: there is no shelf left to put it back on, and refusing would
   * leave the order impossible to cancel.
   */
  private async applyMovements(
    tx: Tx,
    order: { id: string; orderNumber: number },
    movements: PlannedMovement[],
    lines: ResolvedLine[] = [],
  ): Promise<void> {
    for (const movement of movements) {
      try {
        await this.inventory.recordMovement(
          {
            productId: movement.productId,
            variantId: movement.variantId,
            type: movement.type,
            quantity: movement.quantity,
            reason: `طلب #${order.orderNumber}`,
            referenceType: MOVEMENT_REFERENCE.ORDER,
            referenceId: order.id,
          },
          tx,
        );
      } catch (error) {
        if (!(error instanceof AppException)) throw error;

        if (movement.type === InventoryMovementType.RESERVATION) {
          if (error.code === ERROR_CODE.INSUFFICIENT_STOCK) {
            const line = lines.find(
              (candidate) =>
                candidate.productId === movement.productId &&
                candidate.variantId === movement.variantId,
            );
            const label = line
              ? [line.productName, line.variantName].filter(Boolean).join(' - ')
              : 'أحد المنتجات';

            throw new ConflictAppException(
              `الكمية المطلوبة من «${label}» غير متوفرة`,
              ERROR_CODE.INSUFFICIENT_STOCK,
              { productId: movement.productId, variantId: movement.variantId },
            );
          }
          throw error;
        }

        if (error instanceof NotFoundAppException || error instanceof BadRequestAppException) {
          this.logger.warn(
            `Skipped ${movement.type} of ${movement.quantity} for order #${order.orderNumber}: ${error.message}`,
          );
          continue;
        }

        throw error;
      }
    }
  }

  /** What the order currently holds, per product line, according to its ledger entries. */
  private async holdingsOf(tx: Tx, companyId: string, orderId: string): Promise<StockHolding[]> {
    // Movements store signed quantities: RESERVATION +n / RELEASE −n on the reserved
    // counter, SALE −n / RETURN +n on stock.
    return tx.$queryRaw<StockHolding[]>`
      SELECT "productId",
             "variantId",
             COALESCE(SUM(quantity) FILTER (WHERE type IN ('RESERVATION', 'RELEASE')), 0)::int AS reserved,
             COALESCE(-SUM(quantity) FILTER (WHERE type IN ('SALE', 'RETURN')), 0)::int AS sold
      FROM inventory_movements
      WHERE "companyId" = ${companyId}
        AND "referenceType" = ${MOVEMENT_REFERENCE.ORDER}
        AND "referenceId" = ${orderId}
      GROUP BY "productId", "variantId"
    `;
  }

  /** Locks the order row for the rest of the transaction and returns its current state. */
  private async lockOrder(tx: Tx, companyId: string, id: string): Promise<LockedOrder> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE
    `;

    if (locked.length === 0) {
      throw this.notFound();
    }

    return tx.order.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
        status: true,
        deliveryStatus: true,
        confirmedAt: true,
        subtotal: true,
        discount: true,
        deliveryFee: true,
        total: true,
        paidAmount: true,
      },
    });
  }

  /**
   * Per-company sequential number. The advisory lock serializes numbering within one
   * company only, and is released with the transaction.
   */
  private async nextOrderNumber(tx: Tx, companyId: string): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`orders:${companyId}`}))`;

    const [row] = await tx.$queryRaw<{ next: number }[]>`
      SELECT (COALESCE(MAX("orderNumber"), ${ORDER_NUMBER_BASE}) + 1)::int AS next
      FROM orders
      WHERE "companyId" = ${companyId}
    `;

    return row.next;
  }

  private async resolveCustomer(tx: Tx, companyId: string, dto: CreateOrderDto) {
    const select = {
      id: true,
      name: true,
      phone: true,
      address: true,
      city: true,
      status: true,
    } as const;

    let customer = dto.customerId
      ? await tx.customer.findFirst({
          where: { id: dto.customerId, companyId, deletedAt: null },
          select,
        })
      : dto.customer
        ? await tx.customer.findFirst({
            where: { phone: dto.customer.phone, companyId, deletedAt: null },
            select,
          })
        : null;

    if (!customer && dto.customerId) {
      throw new NotFoundAppException('الزبون غير موجود', ERROR_CODE.CUSTOMER_NOT_FOUND);
    }

    if (!customer && dto.customer) {
      customer = await tx.customer.create({
        data: {
          companyId,
          name: dto.customer.name,
          phone: dto.customer.phone,
          city: dto.customer.city ?? null,
          address: dto.customer.address ?? null,
        },
        select,
      });
    }

    if (!customer) {
      throw new BadRequestAppException('حدّد الزبون');
    }

    if (customer.status === CustomerStatus.BLOCKED) {
      throw new BadRequestAppException(
        'الزبون محظور، ألغِ الحظر من ملفه أولاً',
        ERROR_CODE.CUSTOMER_BLOCKED,
      );
    }

    return customer;
  }

  private async assertConversationOf(
    tx: Tx,
    companyId: string,
    conversationId: string,
    customerId: string,
  ): Promise<void> {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, companyId, customerId },
      select: { id: true },
    });

    if (!conversation) {
      throw new BadRequestAppException('المحادثة غير موجودة أو لا تخص هذا الزبون');
    }
  }

  /**
   * Customer totals, recomputed from the orders rather than incremented, so they cannot
   * drift whatever path changed an order.
   *
   * totalOrders counts every order that was not cancelled; totalSpent and the debt only
   * count delivered orders — money the customer actually owes.
   */
  private async recomputeCustomer(tx: Tx, companyId: string, customerId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE customers c
      SET "totalOrders" = agg.orders,
          "totalSpent" = agg.spent,
          "outstandingDebt" = agg.debt,
          "lastOrderAt" = agg.last_order,
          "updatedAt" = NOW()
      FROM (
        SELECT COUNT(*) FILTER (WHERE status <> 'CANCELLED')::int AS orders,
               COALESCE(SUM(total) FILTER (WHERE status = 'DELIVERED'), 0) AS spent,
               COALESCE(SUM(total - "paidAmount") FILTER (WHERE status = 'DELIVERED'), 0) AS debt,
               MAX("createdAt") FILTER (WHERE status <> 'CANCELLED') AS last_order
        FROM orders
        WHERE "customerId" = ${customerId} AND "companyId" = ${companyId}
      ) agg
      WHERE c.id = ${customerId} AND c."companyId" = ${companyId}
    `;
  }

  /** New totals after the subtotal, discount or fee changed, checked against what was paid. */
  private repriced(
    order: LockedOrder,
    subtotal: Prisma.Decimal,
    discount: Prisma.Decimal,
    deliveryFee: Prisma.Decimal,
  ): Prisma.OrderUncheckedUpdateInput {
    if (discount.gt(subtotal)) {
      throw new BadRequestAppException('خصم الطلب أكبر من مجموع المنتجات');
    }

    const total = subtotal.sub(discount).add(deliveryFee);

    if (order.paidAmount.gt(total)) {
      throw new BadRequestAppException(
        'المبلغ المدفوع أكبر من الإجمالي الجديد، عدّل المبلغ المدفوع أولاً',
      );
    }

    return {
      subtotal,
      discount,
      deliveryFee,
      total,
      paymentStatus: paymentStatusOf(order.paidAmount, total),
    };
  }

  private itemData(companyId: string, line: ResolvedLine) {
    return {
      companyId,
      productId: line.productId,
      variantId: line.variantId,
      productName: line.productName,
      variantName: line.variantName,
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      total: line.total,
    };
  }

  private searchFilter(search: string): Prisma.OrderWhereInput[] {
    const latin = toLatinDigits(search).trim();
    const filters: Prisma.OrderWhereInput[] = [
      { customerName: { contains: search, mode: 'insensitive' } },
    ];

    const orderNumber = latin.replace(/^#/, '');
    if (/^\d{1,9}$/.test(orderNumber)) {
      filters.push({ orderNumber: Number(orderNumber) });
    }

    const phoneDigits = latin.replace(/\D/g, '').replace(/^0+/, '');
    if (phoneDigits.length >= 3) {
      filters.push({ customerPhone: { contains: phoneDigits } });
    }

    return filters;
  }

  private async reloadAndPublish(id: string) {
    await this.publish(id);
    return this.findOne(id);
  }

  /** Pushes the list row to everyone watching the company's orders. */
  private async publish(id: string): Promise<void> {
    const row = await this.db.order.findFirst({ where: { id }, select: ORDER_LIST_SELECT });
    if (row) {
      this.realtime.orderUpdated(this.requireCompanyId(), this.toListView(row));
    }
  }

  private toListView(row: OrderListRow) {
    const { _count, ...rest } = row;
    const total = Number(row.total);
    const paidAmount = Number(row.paidAmount);

    return {
      ...rest,
      subtotal: Number(row.subtotal),
      discount: Number(row.discount),
      deliveryFee: Number(row.deliveryFee),
      total,
      paidAmount,
      balanceDue: row.status === OrderStatus.CANCELLED ? 0 : Math.max(total - paidAmount, 0),
      itemsCount: _count.items,
    };
  }

  private toDetailView(row: OrderDetailRow) {
    const { items, customer, ...rest } = row;
    const { deletedAt, ...customerView } = customer;

    return {
      ...this.toListView(rest),
      customer: { ...customerView, deleted: deletedAt !== null },
      items: items.map(({ product, ...item }) => ({
        ...item,
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
        total: Number(item.total),
        imageUrl: product?.images[0]?.url ?? null,
      })),
      allowedTransitions: ORDER_TRANSITIONS[row.status],
      itemsEditable: ITEMS_EDITABLE_STATUSES.includes(row.status),
      pricingEditable: PRICING_EDITABLE_STATUSES.includes(row.status),
    };
  }

  private notFound(): NotFoundAppException {
    return new NotFoundAppException('الطلب غير موجود', ERROR_CODE.ORDER_NOT_FOUND);
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
