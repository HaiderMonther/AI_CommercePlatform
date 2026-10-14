import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OrderSource, OrderStatus, PaymentMethod } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppException } from '@common/exceptions/app.exception';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { CreateOrderDto } from '@modules/orders/dto/order.dto';
import { OrdersService } from '@modules/orders/orders.service';
import { effectiveUnitPrice } from '@modules/orders/order-pricing';

type Tool = Anthropic.Beta.Messages.BetaTool;

/**
 * The agent's whole reach into the platform. A strict allow-list: every tool is read-only
 * except create_order, and none takes a company id — the tenant comes from the request
 * context, so no prompt can point a tool at another store.
 *
 * `strict: true` makes the API guarantee inputs match these schemas; optional values are
 * expressed as nullable rather than omitted, as strict mode requires.
 */
export const AI_TOOLS: Tool[] = [
  {
    name: 'search_products',
    description:
      'Search the store catalog by product name, category, tag or code. Returns matching active products with their current price and whether they can be ordered. Use before quoting any price.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the customer is looking for, in their words.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_product_details',
    description:
      'Full details of one product: description and, for products with colours/sizes, every variant with its own price and availability. Use before taking an order for a product with variants.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { product_id: { type: 'string' } },
      required: ['product_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_customer_orders',
    description: "This customer's latest orders with their status and totals.",
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'create_order',
    description:
      'Place an order for this customer. Call only after the customer has explicitly confirmed your summary of items, delivery details, payment method and total. Stock is reserved when the order is placed.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'string' },
              variant_id: {
                type: ['string', 'null'],
                description: 'Required for products with colours/sizes, otherwise null.',
              },
              quantity: { type: 'integer' },
            },
            required: ['product_id', 'variant_id', 'quantity'],
            additionalProperties: false,
          },
        },
        customer_name: { type: 'string' },
        phone: {
          type: ['string', 'null'],
          description: "Delivery phone. Null to use the customer's phone on file.",
        },
        city: { type: 'string' },
        address: { type: 'string' },
        payment_method: { type: 'string', enum: Object.values(PaymentMethod) },
        notes: { type: ['string', 'null'] },
        customer_confirmed: {
          type: 'boolean',
          description: 'True only if the customer explicitly confirmed the final summary.',
        },
      },
      required: [
        'items',
        'customer_name',
        'phone',
        'city',
        'address',
        'payment_method',
        'notes',
        'customer_confirmed',
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'handover_to_human',
    description:
      'Pass the conversation to a team member. The automatic replies stop until staff hand it back.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Short reason, in Arabic, for the team.' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];

export interface ToolContext {
  customerId: string;
  conversationId: string | null;
  /** Test runs from the settings page: nothing is written. */
  dryRun: boolean;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
  /** Set when the agent asked to hand the conversation over. */
  handoverReason?: string;
  orderId?: string;
}

interface CreateOrderInput {
  items: { product_id: string; variant_id: string | null; quantity: number }[];
  customer_name: string;
  phone: string | null;
  city: string;
  address: string;
  payment_method: PaymentMethod;
  notes: string | null;
  customer_confirmed: boolean;
}

const SEARCH_LIMIT = 8;
/** A second create_order this soon for the same items is a retry, not a new order. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;

const ORDER_STATUS_NAMES: Record<OrderStatus, string> = {
  NEW: 'جديد',
  CONFIRMED: 'مؤكد',
  PREPARING: 'قيد التجهيز',
  SHIPPED: 'تم الشحن',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغى',
};

const fail = (message: string): ToolOutcome => ({
  content: JSON.stringify({ error: message }),
  isError: true,
});
const ok = (value: unknown): ToolOutcome => ({ content: JSON.stringify(value), isError: false });

@Injectable()
export class AiToolExecutor {
  private readonly logger = new Logger(AiToolExecutor.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly orders: OrdersService,
  ) {}

  /** Runs one tool call. Never throws: a failure becomes an error result Claude can read. */
  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolOutcome> {
    const args = (input ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'search_products':
          return await this.searchProducts(String(args.query ?? ''));
        case 'get_product_details':
          return await this.productDetails(String(args.product_id ?? ''));
        case 'get_customer_orders':
          return await this.customerOrders(context.customerId);
        case 'create_order':
          return await this.createOrder(args as unknown as CreateOrderInput, context);
        case 'handover_to_human': {
          const reason = String(args.reason ?? '').trim() || 'طلب المساعد الذكي تدخّل موظف';
          return { ...ok({ handedOver: true }), handoverReason: reason.slice(0, 300) };
        }
        default:
          return fail(`Unknown tool: ${name}`);
      }
    } catch (error) {
      // Business rule failures carry a message meant for people; pass it on as-is.
      if (error instanceof AppException) {
        return fail(error.message);
      }
      this.logger.error(
        `Tool ${name} crashed`,
        error instanceof Error ? error.stack : String(error),
      );
      return fail('Temporary error, try again or hand the conversation over.');
    }
  }

  private async searchProducts(query: string) {
    const words = query
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2)
      .slice(0, 6);

    if (!words.length) {
      return fail('Empty search, ask the customer what they are looking for.');
    }

    const products = await this.db.product.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: words.flatMap((word) => [
          { name: { contains: word, mode: 'insensitive' as const } },
          { sku: { contains: word, mode: 'insensitive' as const } },
          { tags: { has: word } },
          { category: { name: { contains: word, mode: 'insensitive' as const } } },
        ]),
      },
      select: {
        id: true,
        name: true,
        price: true,
        salePrice: true,
        currency: true,
        stock: true,
        reservedStock: true,
        trackInventory: true,
        hasVariants: true,
        category: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
      take: SEARCH_LIMIT,
    });

    return ok({
      results: products.map((product) => ({
        product_id: product.id,
        name: product.name,
        category: product.category?.name ?? null,
        price: Number(effectiveUnitPrice(product)),
        regular_price: product.salePrice ? Number(product.price) : undefined,
        currency: product.currency,
        has_variants: product.hasVariants,
        available: !product.trackInventory || product.stock - product.reservedStock > 0,
      })),
      note: products.length ? undefined : 'No match. Try other words or a broader search.',
    });
  }

  private async productDetails(productId: string) {
    const product = await this.db.product.findFirst({
      where: { id: productId, deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        salePrice: true,
        currency: true,
        stock: true,
        reservedStock: true,
        trackInventory: true,
        hasVariants: true,
        variants: {
          where: { deletedAt: null, isActive: true },
          select: {
            id: true,
            name: true,
            attributes: true,
            price: true,
            salePrice: true,
            stock: true,
            reservedStock: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!product) {
      return fail('Product not found or not for sale.');
    }

    const availableOf = (stock: number, reserved: number) =>
      product.trackInventory ? Math.max(stock - reserved, 0) : null;

    return ok({
      product_id: product.id,
      name: product.name,
      description: product.description,
      currency: product.currency,
      price: Number(effectiveUnitPrice(product)),
      regular_price: product.salePrice ? Number(product.price) : undefined,
      available_quantity: product.hasVariants
        ? undefined
        : availableOf(product.stock, product.reservedStock),
      variants: product.hasVariants
        ? product.variants.map((variant) => ({
            variant_id: variant.id,
            name: variant.name,
            attributes: variant.attributes,
            price: Number(effectiveUnitPrice(product, variant)),
            available_quantity: availableOf(variant.stock, variant.reservedStock),
          }))
        : undefined,
      stock_note: product.trackInventory ? undefined : 'Stock is not tracked; treat as available.',
    });
  }

  private async customerOrders(customerId: string) {
    const orders = await this.db.order.findMany({
      where: { customerId },
      select: {
        orderNumber: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        items: { select: { productName: true, variantName: true, quantity: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return ok({
      orders: orders.map((order) => ({
        order_number: order.orderNumber,
        status: ORDER_STATUS_NAMES[order.status],
        total: Number(order.total),
        currency: order.currency,
        date: order.createdAt.toISOString().slice(0, 10),
        items: order.items.map((item) =>
          [item.quantity, '×', item.productName, item.variantName].filter(Boolean).join(' '),
        ),
      })),
    });
  }

  private async createOrder(input: CreateOrderInput, context: ToolContext) {
    if (input.customer_confirmed !== true) {
      return fail('Send the customer the order summary and wait for their confirmation first.');
    }

    const dto = plainToInstance(CreateOrderDto, {
      customerId: context.customerId,
      ...(context.conversationId ? { conversationId: context.conversationId } : {}),
      items: input.items.map((item) => ({
        productId: item.product_id,
        ...(item.variant_id ? { variantId: item.variant_id } : {}),
        quantity: item.quantity,
      })),
      paymentMethod: input.payment_method,
      customerName: input.customer_name,
      ...(input.phone ? { customerPhone: input.phone } : {}),
      deliveryCity: input.city,
      deliveryAddress: input.address,
      ...(input.notes ? { notes: input.notes } : {}),
    });

    const errors = await validate(dto, { whitelist: true });
    if (errors.length) {
      const messages = errors.flatMap((error) => [
        ...Object.values(error.constraints ?? {}),
        ...(error.children ?? []).flatMap((child) =>
          (child.children ?? []).flatMap((leaf) => Object.values(leaf.constraints ?? {})),
        ),
      ]);
      return fail(`Invalid order details: ${messages.join('; ')}`);
    }

    if (context.dryRun) {
      return ok({
        simulated: true,
        note: 'Test mode: the order was validated but not placed. Reply as if it was placed with number #0000.',
      });
    }

    const duplicate = await this.recentDuplicate(context, input);
    if (duplicate) {
      return ok({
        order_number: duplicate.orderNumber,
        total: Number(duplicate.total),
        note: 'This order was already placed a moment ago; do not place it again.',
      });
    }

    const order = await this.orders.create(dto, OrderSource.AI);
    return {
      ...ok({
        order_number: order.orderNumber,
        total: order.total,
        currency: order.currency,
        payment_method: order.paymentMethod,
        items: order.items.map((item) => ({
          name: [item.productName, item.variantName].filter(Boolean).join(' - '),
          quantity: item.quantity,
          total: item.total,
        })),
      }),
      orderId: order.id,
    };
  }

  /** The same items ordered in this conversation within the last few minutes. */
  private async recentDuplicate(context: ToolContext, input: CreateOrderInput) {
    if (!context.conversationId) return null;

    const recent = await this.db.order.findMany({
      where: {
        conversationId: context.conversationId,
        source: OrderSource.AI,
        status: { not: OrderStatus.CANCELLED },
        createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      select: {
        orderNumber: true,
        total: true,
        items: { select: { productId: true, variantId: true, quantity: true } },
      },
    });

    const signature = (
      items: { productId: string | null; variantId: string | null; quantity: number }[],
    ) =>
      items
        .map((item) => `${item.productId}:${item.variantId ?? ''}:${item.quantity}`)
        .sort()
        .join('|');

    const wanted = signature(
      input.items.map((item) => ({
        productId: item.product_id,
        variantId: item.variant_id,
        quantity: item.quantity,
      })),
    );

    return recent.find((order) => signature(order.items) === wanted) ?? null;
  }
}
