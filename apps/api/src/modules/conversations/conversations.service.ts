import { Inject, Injectable } from '@nestjs/common';
import {
  ChannelType,
  ConversationMode,
  ConversationStatus,
  CustomerStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { PaginatedResult, paginate } from '@common/dto/pagination.dto';
import { BadRequestAppException, NotFoundAppException } from '@common/exceptions/app.exception';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { customerSearchFilter } from '@modules/customers/customer-search';
import { RealtimeService } from '@modules/realtime/realtime.service';
import {
  ACTIVE_CONVERSATION_STATUSES,
  ConversationState,
  HANDOVER_REASON,
  REUSABLE_CONVERSATION_STATUSES,
  modePatch,
  statusPatch,
} from './conversation.rules';
import {
  CreateConversationDto,
  QueryConversationsDto,
  UpdateConversationModeDto,
} from './dto/conversation.dto';

const CONVERSATION_SELECT = {
  id: true,
  channel: true,
  channelId: true,
  status: true,
  mode: true,
  subject: true,
  unreadCount: true,
  handoverReason: true,
  handoverAt: true,
  lastMessageAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true, phone: true, city: true, status: true } },
  assignedUser: { select: { id: true, fullName: true } },
  messages: {
    select: {
      id: true,
      content: true,
      type: true,
      senderType: true,
      senderUserId: true,
      direction: true,
      deliveryStatus: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
} as const satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof CONVERSATION_SELECT }>;

/** Internal view of a conversation used by the messages module before it writes. */
export interface ConversationTarget extends ConversationState {
  id: string;
  customerId: string;
  channel: ChannelType;
  customerStatus: CustomerStatus;
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly context: TenantContextService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async findAll(query: QueryConversationsDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ConversationWhereInput = {
      ...(query.status
        ? { status: query.status }
        : query.active
          ? { status: { in: ACTIVE_CONVERSATION_STATUSES } }
          : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.assignee ? { assignedUserId: this.assigneeOf(query.assignee) } : {}),
      ...(query.unread ? { unreadCount: { gt: 0 } } : {}),
      ...(query.search ? { customer: { OR: customerSearchFilter(query.search) } } : {}),
    };

    const [items, total] = await Promise.all([
      this.db.conversation.findMany({
        where,
        select: CONVERSATION_SELECT,
        orderBy: [
          { lastMessageAt: { sort: query.sortOrder, nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: query.skip,
        take: query.limit,
      }),
      this.db.conversation.count({ where }),
    ]);

    return paginate(items.map((row) => this.toView(row)), total, query.page, query.limit);
  }

  /** Counters for the inbox tabs, computed in one round of parallel counts. */
  async stats() {
    const userId = this.context.getUserId() ?? null;
    const active = { status: { in: ACTIVE_CONVERSATION_STATUSES } };

    const [byStatus, unread, human, mine, unassigned] = await Promise.all([
      this.db.conversation.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.conversation.count({ where: { ...active, unreadCount: { gt: 0 } } }),
      this.db.conversation.count({ where: { ...active, mode: ConversationMode.HUMAN } }),
      this.db.conversation.count({ where: { ...active, assignedUserId: userId } }),
      this.db.conversation.count({ where: { ...active, assignedUserId: null } }),
    ]);

    const statusCounts = Object.fromEntries(
      Object.values(ConversationStatus).map((status) => [
        status,
        byStatus.find((row) => row.status === status)?._count._all ?? 0,
      ]),
    ) as Record<ConversationStatus, number>;

    return {
      byStatus: statusCounts,
      active: statusCounts.OPEN + statusCounts.PENDING,
      unread,
      human,
      mine,
      unassigned,
    };
  }

  async findOne(id: string) {
    const conversation = await this.db.conversation.findFirst({
      where: { id },
      select: {
        ...CONVERSATION_SELECT,
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            altPhone: true,
            email: true,
            address: true,
            city: true,
            notes: true,
            tags: true,
            status: true,
            totalOrders: true,
            totalSpent: true,
            lastOrderAt: true,
            identities: {
              select: { id: true, channel: true, platformUserId: true, displayName: true },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw this.notFound();
    }

    return {
      ...this.toView(conversation),
      customer: { ...conversation.customer, totalSpent: Number(conversation.customer.totalSpent) },
    };
  }

  /**
   * Opens a conversation from the dashboard. If one is already active for this customer
   * on this channel it is returned instead, so two agents clicking "start" at once do not
   * split the thread.
   */
  async create(dto: CreateConversationDto) {
    const customer = await this.db.customer.findFirst({
      where: { id: dto.customerId, deletedAt: null },
      select: { id: true, status: true, phone: true, identities: { select: { channel: true } } },
    });

    if (!customer) {
      throw new NotFoundAppException('الزبون غير موجود', ERROR_CODE.CUSTOMER_NOT_FOUND);
    }
    this.assertNotBlocked(customer.status);

    // Delivery (Phase 5) needs an address on the channel: a WhatsApp number, or a
    // Messenger/Instagram account that has written to the business before.
    const reachable =
      customer.identities.some((identity) => identity.channel === dto.channel) ||
      (dto.channel === ChannelType.WHATSAPP && Boolean(customer.phone));

    if (!reachable) {
      throw new BadRequestAppException(
        dto.channel === ChannelType.WHATSAPP
          ? 'أضف رقم هاتف للزبون أولاً لمراسلته على واتساب'
          : 'لا يمكن بدء محادثة على هذه القناة قبل أن يراسل الزبون المتجر منها',
      );
    }

    const existing = await this.db.conversation.findFirst({
      where: {
        customerId: customer.id,
        channel: dto.channel,
        status: { in: ACTIVE_CONVERSATION_STATUSES },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return this.findOne(existing.id);
    }

    const now = new Date();
    const created = await this.db.conversation.create({
      data: {
        companyId: this.requireCompanyId(),
        customerId: customer.id,
        channel: dto.channel,
        subject: dto.subject?.trim() || null,
        status: ConversationStatus.OPEN,
        // Started by a person, so the AI must not answer in it unless handed back.
        mode: ConversationMode.HUMAN,
        handoverAt: now,
        handoverReason: HANDOVER_REASON.MANUAL,
        assignedUserId: this.context.getUserId() ?? null,
      },
      select: { id: true },
    });

    await this.publish(created.id);
    return this.findOne(created.id);
  }

  async assign(id: string, userId: string | null) {
    const before = await this.getTarget(id);

    if (userId) {
      await this.assertAssignable(userId);
    }

    await this.db.conversation.update({ where: { id }, data: { assignedUserId: userId } });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.CONVERSATION,
      entityId: id,
      oldValue: { assignedUserId: before.assignedUserId },
      newValue: { assignedUserId: userId },
    });

    await this.publish(id);
    return this.findOne(id);
  }

  async updateStatus(id: string, status: ConversationStatus) {
    const before = await this.getTarget(id);

    await this.db.conversation.update({ where: { id }, data: statusPatch(status, new Date()) });

    await this.audit.record({
      action: AUDIT_ACTION.STATUS_CHANGE,
      entity: AUDIT_ENTITY.CONVERSATION,
      entityId: id,
      oldValue: { status: before.status },
      newValue: { status },
    });

    await this.publish(id);
    return this.findOne(id);
  }

  /** Takes a conversation from the AI, or hands it back. */
  async setMode(id: string, dto: UpdateConversationModeDto) {
    const before = await this.getTarget(id);

    await this.db.conversation.update({
      where: { id },
      data: modePatch(dto.mode, dto.reason, new Date()),
    });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.CONVERSATION,
      entityId: id,
      oldValue: { mode: before.mode },
      newValue: { mode: dto.mode, reason: dto.reason ?? null },
    });

    await this.publish(id);
    return this.findOne(id);
  }

  async markRead(id: string) {
    const target = await this.getTarget(id);

    await this.db.conversation.update({ where: { id: target.id }, data: { unreadCount: 0 } });

    await this.publish(id);
    return null;
  }

  /** Loads the fields the messages module needs to decide how a write affects the thread. */
  async getTarget(id: string): Promise<ConversationTarget> {
    const conversation = await this.db.conversation.findFirst({
      where: { id },
      select: {
        id: true,
        customerId: true,
        channel: true,
        status: true,
        mode: true,
        assignedUserId: true,
        customer: { select: { status: true } },
      },
    });

    if (!conversation) {
      throw this.notFound();
    }

    const { customer, ...rest } = conversation;
    return { ...rest, customerStatus: customer.status };
  }

  /** The conversation an inbound message continues, or null when a new one is needed. */
  async findReusable(customerId: string, channel: ChannelType): Promise<ConversationTarget | null> {
    const conversation = await this.db.conversation.findFirst({
      where: { customerId, channel, status: { in: REUSABLE_CONVERSATION_STATUSES } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    return conversation ? this.getTarget(conversation.id) : null;
  }

  /** Pushes the current inbox row to every agent watching the company's conversations. */
  async publish(id: string): Promise<void> {
    const row = await this.db.conversation.findFirst({ where: { id }, select: CONVERSATION_SELECT });
    if (row) {
      this.realtime.conversationUpdated(this.requireCompanyId(), this.toView(row));
    }
  }

  assertNotBlocked(status: CustomerStatus): void {
    if (status === CustomerStatus.BLOCKED) {
      throw new BadRequestAppException(
        'الزبون محظور، ألغِ الحظر من ملفه أولاً',
        ERROR_CODE.CUSTOMER_BLOCKED,
      );
    }
  }

  /** The assignee must be an active member of this company who can reply. */
  private async assertAssignable(userId: string): Promise<void> {
    const user = await this.db.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        role: {
          permissions: { some: { permission: { key: PERMISSIONS.CONVERSATIONS_REPLY } } },
        },
      },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestAppException(
        'لا يمكن إسناد المحادثة لهذا المستخدم',
        ERROR_CODE.ASSIGNEE_INVALID,
      );
    }
  }

  private assigneeOf(assignee: string): string | null {
    if (assignee === 'unassigned') return null;
    if (assignee === 'me') return this.context.getUserId() ?? null;
    return assignee;
  }

  private toView(row: ConversationRow) {
    const { messages, ...rest } = row;
    return { ...rest, lastMessage: messages[0] ?? null };
  }

  private notFound(): NotFoundAppException {
    return new NotFoundAppException('المحادثة غير موجودة', ERROR_CODE.CONVERSATION_NOT_FOUND);
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
