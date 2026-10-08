import { Inject, Injectable } from '@nestjs/common';
import { ChannelType, CustomerStatus, Prisma } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { PaginatedResult, paginate } from '@common/dto/pagination.dto';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { TenantContextService } from '@common/context/tenant-context.service';
import { normalizePhone } from '@common/utils/phone.util';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { customerSearchFilter } from './customer-search';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const CUSTOMER_SELECT = {
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
  outstandingDebt: true,
  lastOrderAt: true,
  lastContactAt: true,
  createdAt: true,
  updatedAt: true,
  identities: {
    select: {
      id: true,
      channel: true,
      platformUserId: true,
      displayName: true,
      profileUrl: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  _count: { select: { conversations: true } },
} as const satisfies Prisma.CustomerSelect;

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

/** What an inbound channel message knows about its sender. */
export interface ChannelSender {
  channel: ChannelType;
  platformUserId: string;
  displayName?: string | null;
  profileUrl?: string | null;
  /** WhatsApp senders are identified by their number; Meta inboxes usually are not. */
  phone?: string | null;
}

export interface ResolvedCustomer {
  customerId: string;
  created: boolean;
}

@Injectable()
export class CustomersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: QueryCustomersDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.channel ? { identities: { some: { channel: query.channel } } } : {}),
      ...(query.search ? { OR: customerSearchFilter(query.search) } : {}),
    };

    // Customers never contacted or never ordered sort after the rest, whichever direction.
    const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
      query.sortBy === 'lastContactAt'
        ? [{ lastContactAt: { sort: query.sortOrder, nulls: 'last' } }, { createdAt: 'desc' }]
        : [{ [query.sortBy]: query.sortOrder }, { createdAt: 'desc' }];

    const [items, total] = await Promise.all([
      this.db.customer.findMany({
        where,
        select: CUSTOMER_SELECT,
        orderBy,
        skip: query.skip,
        take: query.limit,
      }),
      this.db.customer.count({ where }),
    ]);

    return paginate(items.map((row) => this.toView(row)), total, query.page, query.limit);
  }

  async findOne(id: string) {
    const customer = await this.db.customer.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...CUSTOMER_SELECT,
        conversations: {
          select: {
            id: true,
            channel: true,
            status: true,
            mode: true,
            unreadCount: true,
            lastMessageAt: true,
            createdAt: true,
          },
          orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
          take: 10,
        },
      },
    });

    if (!customer) {
      throw new NotFoundAppException('الزبون غير موجود', ERROR_CODE.CUSTOMER_NOT_FOUND);
    }

    const { conversations, ...row } = customer;
    return { ...this.toView(row), recentConversations: conversations };
  }

  async create(dto: CreateCustomerDto) {
    if (dto.phone) {
      await this.assertPhoneAvailable(dto.phone);
    }

    const created = await this.db.customer.create({
      data: {
        companyId: this.requireCompanyId(),
        name: dto.name,
        phone: dto.phone ?? null,
        altPhone: dto.altPhone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        city: dto.city ?? null,
        notes: dto.notes ?? null,
        tags: this.cleanTags(dto.tags),
      },
      select: { id: true },
    });

    const view = await this.findOne(created.id);

    await this.audit.record({
      action: AUDIT_ACTION.CREATE,
      entity: AUDIT_ENTITY.CUSTOMER,
      entityId: created.id,
      newValue: view,
    });

    return view;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const before = await this.findOne(id);

    if (dto.phone && dto.phone !== before.phone) {
      await this.assertPhoneAvailable(dto.phone);
    }

    await this.db.customer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
        ...(dto.altPhone !== undefined ? { altPhone: dto.altPhone || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address || null } : {}),
        ...(dto.city !== undefined ? { city: dto.city || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        ...(dto.tags !== undefined ? { tags: this.cleanTags(dto.tags) } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    const updated = await this.findOne(id);

    await this.audit.record({
      action:
        dto.status !== undefined && dto.status !== before.status
          ? AUDIT_ACTION.STATUS_CHANGE
          : AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.CUSTOMER,
      entityId: id,
      oldValue: before,
      newValue: updated,
    });

    return updated;
  }

  /**
   * Soft delete. Orders and conversations keep pointing at the row, the phone is freed so
   * the person can be added again, and channel identities are dropped: otherwise the next
   * message from the same WhatsApp number would resolve back to a deleted customer.
   */
  async remove(id: string): Promise<void> {
    const customer = await this.findOne(id);
    const deletedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.customerIdentity.deleteMany({ where: { customerId: id } });
      await tx.customer.update({
        where: { id },
        data: {
          deletedAt,
          status: CustomerStatus.ARCHIVED,
          phone: customer.phone ? `${customer.phone}#deleted.${deletedAt.getTime()}` : null,
        },
      });
    });

    await this.audit.record({
      action: AUDIT_ACTION.DELETE,
      entity: AUDIT_ENTITY.CUSTOMER,
      entityId: id,
      oldValue: customer,
    });
  }

  /**
   * Maps a channel sender to a customer, creating one on first contact.
   *
   * Order of precedence: an existing identity on that channel, then a customer with the
   * same phone (the person who ordered by phone and now writes on WhatsApp), then a new
   * customer. The identity is attached in every case, so the next message resolves in one
   * lookup. Used by inbound message processing, never by the dashboard.
   */
  async resolveFromChannel(sender: ChannelSender): Promise<ResolvedCustomer> {
    const companyId = this.requireCompanyId();

    const existing = await this.findIdentity(sender);
    if (existing) {
      return { customerId: existing, created: false };
    }

    const phone = normalizePhone(sender.phone ?? null);
    const displayName = sender.displayName?.trim() || null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const byPhone = phone
          ? await tx.customer.findFirst({
              where: { companyId, phone, deletedAt: null },
              select: { id: true },
            })
          : null;

        const customerId =
          byPhone?.id ??
          (
            await tx.customer.create({
              data: {
                companyId,
                name: displayName ?? phone ?? 'زبون جديد',
                phone,
                lastContactAt: new Date(),
              },
              select: { id: true },
            })
          ).id;

        await tx.customerIdentity.create({
          data: {
            companyId,
            customerId,
            channel: sender.channel,
            platformUserId: sender.platformUserId,
            displayName,
            profileUrl: sender.profileUrl ?? null,
          },
        });

        return { customerId, created: !byPhone };
      });
    } catch (error) {
      // Two webhooks from the same new sender raced; the other one created the records.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.findIdentity(sender);
        if (winner) {
          return { customerId: winner, created: false };
        }
      }
      throw error;
    }
  }

  private async findIdentity(sender: ChannelSender): Promise<string | null> {
    const identity = await this.db.customerIdentity.findFirst({
      where: { channel: sender.channel, platformUserId: sender.platformUserId },
      select: {
        id: true,
        displayName: true,
        customer: { select: { id: true, deletedAt: true } },
      },
    });

    if (!identity || identity.customer.deletedAt) {
      return null;
    }

    const displayName = sender.displayName?.trim();
    if (displayName && displayName !== identity.displayName) {
      await this.db.customerIdentity.update({
        where: { id: identity.id },
        data: { displayName },
      });
    }

    return identity.customer.id;
  }

  private async assertPhoneAvailable(phone: string): Promise<void> {
    const existing = await this.db.customer.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictAppException(
        'رقم الهاتف مسجّل لزبون آخر',
        ERROR_CODE.CUSTOMER_PHONE_TAKEN,
        { customerId: existing.id },
      );
    }
  }

  private cleanTags(tags: string[] | undefined): string[] {
    return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  }

  private toView(row: CustomerRow) {
    const { _count, ...rest } = row;

    return {
      ...rest,
      totalSpent: Number(row.totalSpent),
      outstandingDebt: Number(row.outstandingDebt),
      channels: [...new Set(row.identities.map((identity) => identity.channel))],
      conversationsCount: _count.conversations,
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
