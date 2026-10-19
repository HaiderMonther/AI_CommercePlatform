import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma, UserStatus } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { PermissionKey } from '@common/constants/permissions.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { BadRequestAppException, NotFoundAppException } from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { RealtimeService } from '@modules/realtime/realtime.service';
import { QueryNotificationsDto } from './dto/notification.dto';

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const satisfies Prisma.NotificationSelect;

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  /** Links the notification to what it is about, e.g. `{ orderId }`. Also the dedupe key. */
  data: Record<string, string | number | null>;
  /** Everyone in the company who holds this permission… */
  permission: PermissionKey;
  /** …or only these users, when the event concerns specific people. */
  userIds?: string[];
  /**
   * Skip users who already have an unread notification of this type about the same
   * thing (same `data[dedupeKey]`) from within this window.
   */
  dedupe?: { key: string; withinMs: number };
}

/**
 * In-app notifications. One row per recipient, so each person reads and clears their own;
 * the realtime push goes to their personal room.
 *
 * Notifying is best-effort and never throws into the caller: an order that was placed
 * must not fail because a notification could not be written.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
    private readonly realtime: RealtimeService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    const companyId = this.context.getCompanyId();
    if (!companyId) return;

    try {
      let recipients = await this.recipients(companyId, input.permission, input.userIds);

      // The person who caused the event does not need to hear about it.
      const actor = this.context.getUserId();
      recipients = recipients.filter((id) => id !== actor);

      if (input.dedupe && recipients.length) {
        const already = await this.prisma.notification.findMany({
          where: {
            companyId,
            type: input.type,
            userId: { in: recipients },
            readAt: null,
            createdAt: { gte: new Date(Date.now() - input.dedupe.withinMs) },
            data: {
              path: [input.dedupe.key],
              equals: input.data[input.dedupe.key] ?? Prisma.AnyNull,
            },
          },
          select: { userId: true },
        });
        const skip = new Set(already.map((row) => row.userId));
        recipients = recipients.filter((id) => !skip.has(id));
      }

      for (const userId of recipients) {
        const notification = await this.prisma.notification.create({
          data: {
            companyId,
            userId,
            type: input.type,
            title: input.title,
            body: input.body,
            data: input.data,
          },
          select: NOTIFICATION_SELECT,
        });
        this.realtime.notificationCreated(userId, notification);
      }
    } catch (error) {
      this.logger.error(
        `Notification ${input.type} not delivered`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async findMine(query: QueryNotificationsDto) {
    const userId = this.requireUserId();
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread ? { readAt: null } : {}),
    };

    const [items, total, unread] = await Promise.all([
      this.db.notification.findMany({
        where,
        select: NOTIFICATION_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.db.notification.count({ where }),
      this.db.notification.count({ where: { userId, readAt: null } }),
    ]);

    return {
      items,
      unread,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
        hasNext: query.page * query.limit < total,
        hasPrev: query.page > 1,
      },
    };
  }

  async unreadCount() {
    return {
      unread: await this.db.notification.count({
        where: { userId: this.requireUserId(), readAt: null },
      }),
    };
  }

  async markRead(id: string) {
    const userId = this.requireUserId();
    const notification = await this.db.notification.findFirst({
      where: { id, userId },
      select: { id: true, readAt: true },
    });

    if (!notification) {
      throw new NotFoundAppException('الإشعار غير موجود');
    }

    if (!notification.readAt) {
      await this.db.notification.update({ where: { id }, data: { readAt: new Date() } });
    }
    return this.unreadCount();
  }

  async markAllRead() {
    await this.db.notification.updateMany({
      where: { userId: this.requireUserId(), readAt: null },
      data: { readAt: new Date() },
    });
    return { unread: 0 };
  }

  /** Active members of the company who hold the permission (optionally among `userIds`). */
  private async recipients(
    companyId: string,
    permission: PermissionKey,
    userIds?: string[],
  ): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        ...(userIds ? { id: { in: userIds } } : {}),
        role: { permissions: { some: { permission: { key: permission } } } },
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  private requireUserId(): string {
    const userId = this.context.getUserId();
    if (!userId) {
      throw new BadRequestAppException(
        'الإشعارات متاحة لمستخدمي الشركات فقط',
        ERROR_CODE.FORBIDDEN,
      );
    }
    return userId;
  }
}
