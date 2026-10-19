import { Inject, Injectable } from '@nestjs/common';
import { ConversationMode, ConversationStatus, OrderStatus } from '@prisma/client';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { AiClient } from '@modules/ai/ai-client';
import { InventoryService } from '@modules/inventory/inventory.service';
import { OPEN_ORDER_STATUSES } from '@modules/orders/order.rules';
import { addDays, localDate, resolveRange } from './report-range';
import { ReportsService } from './reports.service';

/** The trend shown on the dashboard. */
const TREND_DAYS = 14;
/** The period the headline numbers compare. */
const PERIOD_DAYS = 30;

/**
 * The home screen's numbers. Every signed-in member can open it; each section is filled
 * only when the member may see that area, so a sales agent without `orders.read` never
 * receives revenue figures.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly context: TenantContextService,
    private readonly reports: ReportsService,
    private readonly inventory: InventoryService,
    private readonly ai: AiClient,
  ) {}

  async summary() {
    const can = (permission: string) => this.context.getPermissions().includes(permission);
    const range = await this.reports.range({});
    const today = localDate(new Date(), range.timezone);

    const [sales, conversations, inventory, customers, ai] = await Promise.all([
      can(PERMISSIONS.ORDERS_READ) ? this.sales(today) : null,
      can(PERMISSIONS.CONVERSATIONS_READ) ? this.conversations() : null,
      can(PERMISSIONS.INVENTORY_READ) ? this.inventoryHealth() : null,
      can(PERMISSIONS.CUSTOMERS_READ) ? this.customers(today, range.timezone) : null,
      can(PERMISSIONS.REPORTS_READ) ? this.aiActivity(today) : null,
    ]);

    return { generatedAt: new Date(), today, sales, conversations, inventory, customers, ai };
  }

  private async sales(today: string) {
    const period = await this.reports.range({
      from: addDays(today, -(PERIOD_DAYS - 1)),
      to: today,
    });
    const trend = await this.reports.range({ from: addDays(today, -(TREND_DAYS - 1)), to: today });
    const todayRange = await this.reports.range({ from: today, to: today });

    const [report, trendReport, todayReport, open, recent] = await Promise.all([
      this.reports.sales(period),
      this.reports.sales(trend),
      this.reports.sales(todayRange),
      this.db.order.groupBy({
        by: ['status'],
        where: { status: { in: OPEN_ORDER_STATUSES } },
        _count: { _all: true },
      }),
      this.db.order.findMany({
        select: {
          id: true,
          orderNumber: true,
          customerName: true,
          total: true,
          currency: true,
          status: true,
          source: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    return {
      today: { orders: todayReport.totals.orders, value: todayReport.totals.value },
      period: {
        days: PERIOD_DAYS,
        orders: report.totals.orders,
        value: report.totals.value,
        averageOrderValue: report.totals.averageOrderValue,
        deliveredRevenue: report.totals.deliveredRevenue,
        change: report.totals.change,
        aiShare: share(
          report.bySource.find((row) => row.key === 'AI')?.count ?? 0,
          report.totals.orders,
        ),
      },
      trend: trendReport.series.map(({ day, orders, value }) => ({ day, orders, value })),
      open: Object.fromEntries(
        OPEN_ORDER_STATUSES.map((status) => [
          status,
          open.find((row) => row.status === status)?._count._all ?? 0,
        ]),
      ) as Record<OrderStatus, number>,
      recent: recent.map((order) => ({ ...order, total: Number(order.total) })),
    };
  }

  private async conversations() {
    const active = { status: { in: [ConversationStatus.OPEN, ConversationStatus.PENDING] } };

    const [open, unread, waiting, mine] = await Promise.all([
      this.db.conversation.count({ where: active }),
      this.db.conversation.count({ where: { ...active, unreadCount: { gt: 0 } } }),
      // Handed to people and nobody has picked them up.
      this.db.conversation.count({
        where: { ...active, mode: ConversationMode.HUMAN, assignedUserId: null },
      }),
      this.db.conversation.count({
        where: { ...active, assignedUserId: this.context.getUserId() ?? '-' },
      }),
    ]);

    return { open, unread, waitingForStaff: waiting, assignedToMe: mine };
  }

  private async inventoryHealth() {
    const [summary, low] = await Promise.all([
      this.inventory.getSummary(),
      this.inventory.findLowStock(6),
    ]);
    return {
      lowStockCount: summary.lowStockCount,
      outOfStockCount: summary.outOfStockCount,
      lowStock: low,
    };
  }

  private async customers(today: string, timezone: string) {
    const month = resolveRange({ from: addDays(today, -(PERIOD_DAYS - 1)), to: today }, timezone);
    const since = new Date(Date.parse(`${month.from}T00:00:00Z`));

    const [total, recent] = await Promise.all([
      this.db.customer.count({ where: { deletedAt: null } }),
      this.db.customer.count({ where: { deletedAt: null, createdAt: { gte: since } } }),
    ]);
    return { total, newInPeriod: recent };
  }

  private async aiActivity(today: string) {
    const report = await this.reports.ai(
      await this.reports.range({ from: addDays(today, -(PERIOD_DAYS - 1)), to: today }),
    );
    return { configured: this.ai.configured, ...report.totals };
  }
}

function share(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 1000) / 10 : null;
}
