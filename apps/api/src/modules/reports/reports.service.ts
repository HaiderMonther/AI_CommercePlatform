import { Injectable } from '@nestjs/common';
import { ChannelType, OrderSource, OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { BadRequestAppException } from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { ReportRange, changeRatio, eachDay, previousRange, resolveRange } from './report-range';

const sql = Prisma.sql;

/** Raw aggregates come back as bigint (counts) and numeric (sums); the API speaks numbers. */
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));

/**
 * Read-only aggregates over orders, conversations and AI activity.
 *
 * Every query filters by the company explicitly (raw SQL bypasses the tenant-scoped
 * client), bounds dates in the company's timezone, and groups by output position so a
 * timezone passed as a parameter does not break GROUP BY.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
  ) {}

  async range(input: { from?: string; to?: string }): Promise<ReportRange> {
    return resolveRange(input, await this.timezone());
  }

  // -------------------------------------------------------------------------------
  // Sales
  // -------------------------------------------------------------------------------

  async sales(range: ReportRange) {
    const companyId = this.requireCompanyId();
    const created = this.between(sql`o."createdAt"`, range);

    const [
      totals,
      previous,
      delivered,
      series,
      deliveredSeries,
      byStatus,
      bySource,
      byPayment,
      cities,
    ] = await Promise.all([
      this.orderTotals(companyId, range),
      this.orderTotals(companyId, previousRange(range)),
      this.prisma.$queryRaw<{ count: bigint; revenue: unknown; collected: unknown }[]>`
          SELECT COUNT(*) AS count, SUM(total) AS revenue, SUM("paidAmount") AS collected
          FROM orders o
          WHERE o."companyId" = ${companyId} AND o.status = 'DELIVERED'
            AND ${this.between(sql`o."deliveredAt"`, range)}
        `,
      this.prisma.$queryRaw<{ day: string; orders: bigint; value: unknown }[]>`
          SELECT ${this.dayOf(sql`o."createdAt"`, range)} AS day, COUNT(*) AS orders, SUM(total) AS value
          FROM orders o
          WHERE o."companyId" = ${companyId} AND o.status <> 'CANCELLED' AND ${created}
          GROUP BY 1
        `,
      this.prisma.$queryRaw<{ day: string; revenue: unknown }[]>`
          SELECT ${this.dayOf(sql`o."deliveredAt"`, range)} AS day, SUM(total) AS revenue
          FROM orders o
          WHERE o."companyId" = ${companyId} AND o.status = 'DELIVERED'
            AND ${this.between(sql`o."deliveredAt"`, range)}
          GROUP BY 1
        `,
      this.prisma.$queryRaw<{ key: OrderStatus; count: bigint; value: unknown }[]>`
          SELECT status AS key, COUNT(*) AS count, SUM(total) AS value
          FROM orders o WHERE o."companyId" = ${companyId} AND ${created}
          GROUP BY 1
        `,
      this.prisma.$queryRaw<{ key: OrderSource; count: bigint; value: unknown }[]>`
          SELECT source AS key, COUNT(*) AS count, SUM(total) AS value
          FROM orders o WHERE o."companyId" = ${companyId} AND o.status <> 'CANCELLED' AND ${created}
          GROUP BY 1
        `,
      this.prisma.$queryRaw<{ key: PaymentMethod; count: bigint; value: unknown }[]>`
          SELECT "paymentMethod" AS key, COUNT(*) AS count, SUM(total) AS value
          FROM orders o WHERE o."companyId" = ${companyId} AND o.status <> 'CANCELLED' AND ${created}
          GROUP BY 1
        `,
      this.prisma.$queryRaw<{ key: string | null; count: bigint; value: unknown }[]>`
          SELECT NULLIF(TRIM("deliveryCity"), '') AS key, COUNT(*) AS count, SUM(total) AS value
          FROM orders o WHERE o."companyId" = ${companyId} AND o.status <> 'CANCELLED' AND ${created}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 8
        `,
    ]);

    const byDay = new Map(series.map((row) => [row.day, row]));
    const revenueByDay = new Map(deliveredSeries.map((row) => [row.day, num(row.revenue)]));
    const breakdown = <K extends string>(
      rows: { key: K | null; count: bigint; value: unknown }[],
    ) =>
      rows
        .map((row) => ({ key: row.key, count: num(row.count), value: num(row.value) }))
        .sort((a, b) => b.value - a.value);

    return {
      range,
      totals: {
        ...totals,
        deliveredOrders: num(delivered[0]?.count),
        deliveredRevenue: num(delivered[0]?.revenue),
        collected: num(delivered[0]?.collected),
        change: {
          orders: changeRatio(totals.orders, previous.orders),
          value: changeRatio(totals.value, previous.value),
        },
      },
      series: eachDay(range).map((day) => ({
        day,
        orders: num(byDay.get(day)?.orders),
        value: num(byDay.get(day)?.value),
        deliveredRevenue: revenueByDay.get(day) ?? 0,
      })),
      byStatus: breakdown(byStatus),
      bySource: breakdown(bySource),
      byPaymentMethod: breakdown(byPayment),
      topCities: breakdown(cities),
    };
  }

  /** Orders placed in the range that still count: everything but cancelled. */
  private async orderTotals(companyId: string, range: ReportRange) {
    const [row] = await this.prisma.$queryRaw<
      { orders: bigint; value: unknown; cancelled: bigint; customers: bigint }[]
    >`
      SELECT COUNT(*) FILTER (WHERE status <> 'CANCELLED') AS orders,
             SUM(total) FILTER (WHERE status <> 'CANCELLED') AS value,
             COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
             COUNT(DISTINCT "customerId") FILTER (WHERE status <> 'CANCELLED') AS customers
      FROM orders o
      WHERE o."companyId" = ${companyId} AND ${this.between(sql`o."createdAt"`, range)}
    `;

    const orders = num(row?.orders);
    const value = num(row?.value);
    return {
      orders,
      value,
      averageOrderValue: orders ? Math.round(value / orders) : 0,
      cancelled: num(row?.cancelled),
      customers: num(row?.customers),
    };
  }

  // -------------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------------

  async products(range: ReportRange) {
    const companyId = this.requireCompanyId();

    const rows = await this.prisma.$queryRaw<
      {
        productId: string | null;
        name: string;
        quantity: bigint;
        revenue: unknown;
        orders: bigint;
        stock: number | null;
        deleted: boolean | null;
      }[]
    >`
      SELECT i."productId",
             MAX(i."productName") AS name,
             SUM(i.quantity) AS quantity,
             SUM(i.total) AS revenue,
             COUNT(DISTINCT i."orderId") AS orders,
             MAX(p.stock) AS stock,
             BOOL_OR(p."deletedAt" IS NOT NULL) AS deleted
      FROM order_items i
      JOIN orders o ON o.id = i."orderId"
      LEFT JOIN products p ON p.id = i."productId"
      WHERE o."companyId" = ${companyId}
        AND o.status <> 'CANCELLED'
        AND ${this.between(sql`o."createdAt"`, range)}
      GROUP BY 1
      ORDER BY 4 DESC
      LIMIT 50
    `;

    const items = rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      quantity: num(row.quantity),
      revenue: num(row.revenue),
      orders: num(row.orders),
      stock: row.stock,
      deleted: Boolean(row.deleted),
    }));

    return {
      range,
      byRevenue: items.slice(0, 10),
      byQuantity: [...items].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
      totals: {
        products: items.length,
        quantity: items.reduce((sum, item) => sum + item.quantity, 0),
        revenue: items.reduce((sum, item) => sum + item.revenue, 0),
      },
    };
  }

  // -------------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------------

  async conversations(range: ReportRange) {
    const companyId = this.requireCompanyId();
    const created = this.between(sql`c."createdAt"`, range);

    const [channels, messages, series, handovers] = await Promise.all([
      this.prisma.$queryRaw<{ key: ChannelType; count: bigint }[]>`
        SELECT channel AS key, COUNT(*) AS count
        FROM conversations c WHERE c."companyId" = ${companyId} AND ${created}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<{ customer: bigint; ai: bigint; agent: bigint }[]>`
        SELECT COUNT(*) FILTER (WHERE "senderType" = 'CUSTOMER') AS customer,
               COUNT(*) FILTER (WHERE "senderType" = 'AI') AS ai,
               COUNT(*) FILTER (WHERE "senderType" = 'AGENT') AS agent
        FROM messages m
        WHERE m."companyId" = ${companyId} AND ${this.between(sql`m."createdAt"`, range)}
      `,
      this.prisma.$queryRaw<{ day: string; customer: bigint; replies: bigint }[]>`
        SELECT ${this.dayOf(sql`m."createdAt"`, range)} AS day,
               COUNT(*) FILTER (WHERE "senderType" = 'CUSTOMER') AS customer,
               COUNT(*) FILTER (WHERE "senderType" IN ('AI', 'AGENT')) AS replies
        FROM messages m
        WHERE m."companyId" = ${companyId} AND ${this.between(sql`m."createdAt"`, range)}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM conversations c
        WHERE c."companyId" = ${companyId} AND ${this.between(sql`c."handoverAt"`, range)}
      `,
    ]);

    const byDay = new Map(series.map((row) => [row.day, row]));
    const counts = messages[0];

    return {
      range,
      totals: {
        conversations: channels.reduce((sum, row) => sum + num(row.count), 0),
        customerMessages: num(counts?.customer),
        aiReplies: num(counts?.ai),
        agentReplies: num(counts?.agent),
        handovers: num(handovers[0]?.count),
      },
      byChannel: channels.map((row) => ({ key: row.key, count: num(row.count) })),
      series: eachDay(range).map((day) => ({
        day,
        customerMessages: num(byDay.get(day)?.customer),
        replies: num(byDay.get(day)?.replies),
      })),
    };
  }

  // -------------------------------------------------------------------------------
  // AI agent
  // -------------------------------------------------------------------------------

  async ai(range: ReportRange) {
    const companyId = this.requireCompanyId();
    // Test runs from the settings page have no conversation; they are not activity.
    const runs = sql`a."companyId" = ${companyId} AND a."conversationId" IS NOT NULL
      AND ${this.between(sql`a."createdAt"`, range)}`;

    const [totals, models, orders, conversations] = await Promise.all([
      this.prisma.$queryRaw<
        {
          runs: bigint;
          failed: bigint;
          handovers: bigint;
          prompt: unknown;
          completion: unknown;
          latency: unknown;
        }[]
      >`
        SELECT COUNT(*) AS runs,
               COUNT(*) FILTER (WHERE NOT success) AS failed,
               COUNT(*) FILTER (WHERE intent = 'handover') AS handovers,
               SUM("promptTokens") AS prompt,
               SUM("completionTokens") AS completion,
               AVG("latencyMs") AS latency
        FROM ai_interactions a WHERE ${runs}
      `,
      this.prisma.$queryRaw<{ key: string; runs: bigint; tokens: unknown }[]>`
        SELECT model AS key, COUNT(*) AS runs, SUM("totalTokens") AS tokens
        FROM ai_interactions a WHERE ${runs}
        GROUP BY 1 ORDER BY 2 DESC
      `,
      this.prisma.$queryRaw<{ count: bigint; value: unknown }[]>`
        SELECT COUNT(*) AS count, SUM(total) AS value
        FROM orders o
        WHERE o."companyId" = ${companyId} AND o.source = 'AI' AND o.status <> 'CANCELLED'
          AND ${this.between(sql`o."createdAt"`, range)}
      `,
      // Conversations opened in the range: how many the AI saw through without a person.
      this.prisma.$queryRaw<{ total: bigint; handedOver: bigint }[]>`
        SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE "handoverAt" IS NOT NULL) AS "handedOver"
        FROM conversations c
        WHERE c."companyId" = ${companyId} AND ${this.between(sql`c."createdAt"`, range)}
      `,
    ]);

    const row = totals[0];
    const count = num(row?.runs);
    const total = num(conversations[0]?.total);
    const handedOver = num(conversations[0]?.handedOver);

    return {
      range,
      totals: {
        runs: count,
        successRate: count ? Math.round(((count - num(row?.failed)) / count) * 1000) / 10 : null,
        handovers: num(row?.handovers),
        averageLatencyMs: Math.round(num(row?.latency)),
        promptTokens: num(row?.prompt),
        completionTokens: num(row?.completion),
        orders: num(orders[0]?.count),
        ordersValue: num(orders[0]?.value),
        conversations: total,
        // Share of new conversations no person had to take over.
        automationRate: total ? Math.round(((total - handedOver) / total) * 1000) / 10 : null,
      },
      byModel: models.map((model) => ({
        key: model.key,
        runs: num(model.runs),
        tokens: num(model.tokens),
      })),
    };
  }

  // -------------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------------

  /** Orders placed in the range as CSV rows, newest first. */
  async ordersCsv(range: ReportRange): Promise<string> {
    const companyId = this.requireCompanyId();

    const orders = await this.prisma.$queryRaw<
      {
        orderNumber: number;
        createdAt: string;
        status: string;
        source: string;
        customerName: string;
        customerPhone: string;
        deliveryCity: string | null;
        deliveryAddress: string | null;
        paymentMethod: string;
        paymentStatus: string;
        items: string;
        subtotal: unknown;
        discount: unknown;
        deliveryFee: unknown;
        total: unknown;
        paidAmount: unknown;
      }[]
    >`
      SELECT o."orderNumber",
             to_char((o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${range.timezone}, 'YYYY-MM-DD HH24:MI') AS "createdAt",
             o.status, o.source, o."customerName", o."customerPhone", o."deliveryCity",
             o."deliveryAddress", o."paymentMethod", o."paymentStatus",
             (SELECT string_agg(i.quantity || ' × ' || i."productName" || COALESCE(' (' || i."variantName" || ')', ''), ' | ')
              FROM order_items i WHERE i."orderId" = o.id) AS items,
             o.subtotal, o.discount, o."deliveryFee", o.total, o."paidAmount"
      FROM orders o
      WHERE o."companyId" = ${companyId} AND ${this.between(sql`o."createdAt"`, range)}
      ORDER BY o."createdAt" DESC
      LIMIT 50000
    `;

    const header = [
      'رقم الطلب',
      'التاريخ',
      'الحالة',
      'المصدر',
      'الزبون',
      'الهاتف',
      'المدينة',
      'العنوان',
      'طريقة الدفع',
      'حالة الدفع',
      'المنتجات',
      'المجموع',
      'الخصم',
      'التوصيل',
      'الإجمالي',
      'المدفوع',
    ];

    const lines = orders.map((order) =>
      [
        order.orderNumber,
        order.createdAt,
        order.status,
        order.source,
        order.customerName,
        order.customerPhone,
        order.deliveryCity,
        order.deliveryAddress,
        order.paymentMethod,
        order.paymentStatus,
        order.items,
        num(order.subtotal),
        num(order.discount),
        num(order.deliveryFee),
        num(order.total),
        num(order.paidAmount),
      ]
        .map(csvCell)
        .join(','),
    );

    // The BOM makes Excel open the file as UTF-8, so Arabic does not come out garbled.
    return '﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n');
  }

  // -------------------------------------------------------------------------------

  /** `column` falls within the range's days, in the company's timezone. */
  private between(column: Prisma.Sql, range: ReportRange): Prisma.Sql {
    return sql`${column} >= ((${range.from}::date)::timestamp AT TIME ZONE ${range.timezone}) AT TIME ZONE 'UTC'
      AND ${column} < ((${range.to}::date + 1)::timestamp AT TIME ZONE ${range.timezone}) AT TIME ZONE 'UTC'`;
  }

  private dayOf(column: Prisma.Sql, range: ReportRange): Prisma.Sql {
    return sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${range.timezone}, 'YYYY-MM-DD')`;
  }

  private async timezone(): Promise<string> {
    const company = await this.prisma.company.findUnique({
      where: { id: this.requireCompanyId() },
      select: { timezone: true },
    });
    return company?.timezone || 'Asia/Baghdad';
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

/** A CSV field, quoted when needed, and defused against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // A customer named "=HYPERLINK(...)" must not become a live formula in Excel.
  // A phone number like +9647701234567 is data, not a formula.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text) && !/^\+\d+$/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
