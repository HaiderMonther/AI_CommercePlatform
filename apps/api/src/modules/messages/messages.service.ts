import { Inject, Injectable } from '@nestjs/common';
import {
  ConversationStatus,
  MessageDeliveryStatus,
  MessageDirection,
  MessageType,
  Prisma,
  SenderType,
} from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { agentReplyPatch, inboundPatch } from '@modules/conversations/conversation.rules';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { ChannelSender, CustomersService } from '@modules/customers/customers.service';
import { OutboundService } from '@modules/channels/outbound.service';
import { RealtimeService } from '@modules/realtime/realtime.service';
import { advancesDelivery } from './delivery-status';
import { QueryMessagesDto, SendMessageDto } from './dto/message.dto';
import { MESSAGE_SELECT, MessageView } from './message.select';

/** A customer message as a channel provider (Phase 5) hands it over. */
export interface InboundMessageInput {
  sender: ChannelSender;
  channelId?: string | null;
  /** Provider message id; makes redelivered webhooks a no-op. */
  externalId?: string | null;
  type?: MessageType;
  content: string;
  mediaUrl?: string | null;
  metadata?: Prisma.InputJsonValue;
  receivedAt?: Date;
}

export interface InboundResult {
  messageId: string;
  conversationId: string;
  customerId: string;
  duplicate: boolean;
  conversationCreated: boolean;
}

@Injectable()
export class MessagesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
    private readonly conversations: ConversationsService,
    private readonly customers: CustomersService,
    private readonly realtime: RealtimeService,
    private readonly outbound: OutboundService,
  ) {}

  /** A page of the thread, oldest first, ending just before `before` (or at the latest). */
  async list(conversationId: string, query: QueryMessagesDto) {
    await this.conversations.getTarget(conversationId);

    if (query.before) {
      const anchor = await this.db.message.findFirst({
        where: { id: query.before, conversationId },
        select: { id: true },
      });
      if (!anchor) {
        throw new BadRequestAppException('مؤشر الرسائل غير صالح');
      }
    }

    const rows = await this.db.message.findMany({
      where: { conversationId },
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).reverse();

    return { items, hasMore, nextBefore: hasMore ? items[0].id : null };
  }

  /**
   * Stores an agent reply and applies its side effects on the conversation (take over
   * from the AI, reopen, self-assign) in one transaction.
   *
   * The message is saved as PENDING and handed to the outbound worker once committed;
   * delivery receipts then move it to SENT / DELIVERED / READ, or FAILED with a reason.
   */
  async send(conversationId: string, dto: SendMessageDto) {
    const target = await this.conversations.getTarget(conversationId);
    this.conversations.assertNotBlocked(target.customerStatus);

    const companyId = this.requireCompanyId();
    const agentId = this.context.getUserId() as string;
    const now = new Date();

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          companyId,
          conversationId,
          senderType: SenderType.AGENT,
          senderUserId: agentId,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          content: dto.content,
          deliveryStatus: MessageDeliveryStatus.PENDING,
          createdAt: now,
        },
        select: MESSAGE_SELECT,
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: agentReplyPatch(target, agentId, now),
      });

      return created;
    });

    this.realtime.messageCreated(conversationId, message);
    await this.conversations.publish(conversationId);

    // After the response: the agent sees the bubble at once, the ticks follow live.
    void this.outbound.dispatch(message.id);

    return message;
  }

  /**
   * Stores a reply written by the AI agent and queues it for delivery. Unlike an agent
   * reply it leaves mode, assignee and unread count alone: the AI answering does not mean
   * a person has seen the conversation.
   */
  async recordAiReply(conversationId: string, content: string) {
    const companyId = this.requireCompanyId();
    const now = new Date();

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          companyId,
          conversationId,
          senderType: SenderType.AI,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          content,
          deliveryStatus: MessageDeliveryStatus.PENDING,
          createdAt: now,
        },
        select: MESSAGE_SELECT,
      });

      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
      return created;
    });

    this.realtime.messageCreated(conversationId, message);
    await this.conversations.publish(conversationId);
    void this.outbound.dispatch(message.id);

    return message;
  }

  /** Sends a FAILED reply again, e.g. after the channel token was replaced. */
  async retry(conversationId: string, messageId: string) {
    await this.conversations.getTarget(conversationId);

    const message = await this.db.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, direction: true, deliveryStatus: true },
    });

    if (!message) {
      throw new NotFoundAppException('الرسالة غير موجودة');
    }
    if (
      message.direction !== MessageDirection.OUTBOUND ||
      message.deliveryStatus !== MessageDeliveryStatus.FAILED
    ) {
      throw new ConflictAppException(
        'يمكن إعادة إرسال الرسائل الفاشلة فقط',
        ERROR_CODE.MESSAGE_NOT_RETRYABLE,
      );
    }

    // Clears the attempt counter so the retry gets a full set of attempts.
    await this.prisma.$executeRaw`
      UPDATE messages
      SET "deliveryStatus" = 'PENDING',
          "failureReason" = NULL,
          metadata = CASE WHEN metadata IS NULL THEN NULL ELSE metadata - 'delivery' END
      WHERE id = ${messageId} AND "companyId" = ${this.requireCompanyId()}
    `;

    const updated = await this.db.message.findFirstOrThrow({
      where: { id: messageId },
      select: MESSAGE_SELECT,
    });
    this.realtime.messageUpdated(conversationId, updated);
    await this.conversations.publish(conversationId);

    void this.outbound.dispatch(messageId);
    return updated;
  }

  /**
   * Applies a delivery receipt from the provider. Receipts arrive out of order, so only
   * forward moves are applied. Returns false when the message is not ours (sent from
   * Meta's own inbox, say).
   */
  async applyDeliveryStatus(
    externalId: string,
    status: MessageDeliveryStatus,
    failureReason: string | null,
  ): Promise<boolean> {
    const message = await this.db.message.findFirst({
      where: { externalId, direction: MessageDirection.OUTBOUND },
      select: { id: true, conversationId: true, deliveryStatus: true },
    });

    if (!message) {
      return false;
    }
    if (!advancesDelivery(message.deliveryStatus, status)) {
      return true;
    }

    const updated = await this.db.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: status,
        ...(status === MessageDeliveryStatus.FAILED
          ? { failureReason: failureReason?.slice(0, 500) ?? 'فشل التسليم لدى Meta' }
          : {}),
      },
      select: MESSAGE_SELECT,
    });

    this.realtime.messageUpdated(message.conversationId, updated);
    await this.conversations.publish(message.conversationId);
    return true;
  }

  /**
   * Records a customer message: resolves (or creates) the customer, continues the open
   * conversation or starts one, and stores the message — once. A provider that redelivers
   * the same webhook gets the original message back with `duplicate: true`.
   *
   * Runs inside a tenant context set by the caller (the webhook worker, Phase 5).
   */
  async recordInbound(input: InboundMessageInput): Promise<InboundResult> {
    const companyId = this.requireCompanyId();

    const duplicate = await this.findByExternalId(input.externalId);
    if (duplicate) {
      return duplicate;
    }

    const { customerId } = await this.customers.resolveFromChannel(input.sender);
    const target = await this.conversations.findReusable(customerId, input.sender.channel);
    const at = input.receivedAt ?? new Date();

    let result: { message: MessageView; created: boolean };

    try {
      result = await this.prisma.$transaction(async (tx) => {
        const conversationId =
          target?.id ??
          (
            await tx.conversation.create({
              data: {
                companyId,
                customerId,
                channel: input.sender.channel,
                channelId: input.channelId ?? null,
                status: ConversationStatus.OPEN,
              },
              select: { id: true },
            })
          ).id;

        const message = await tx.message.create({
          data: {
            companyId,
            conversationId,
            senderType: SenderType.CUSTOMER,
            direction: MessageDirection.INBOUND,
            type: input.type ?? MessageType.TEXT,
            content: input.content,
            mediaUrl: input.mediaUrl ?? null,
            metadata: input.metadata,
            externalId: input.externalId ?? null,
            deliveryStatus: MessageDeliveryStatus.DELIVERED,
            createdAt: at,
          },
          select: MESSAGE_SELECT,
        });

        await tx.conversation.update({
          where: { id: conversationId },
          data: target ? inboundPatch(target, at) : { lastMessageAt: at, unreadCount: 1 },
        });

        await tx.customer.update({ where: { id: customerId }, data: { lastContactAt: at } });

        return { message, created: !target };
      });
    } catch (error) {
      // The same webhook processed concurrently: the unique (companyId, externalId) key
      // lets exactly one insert through.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.findByExternalId(input.externalId);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }

    this.realtime.messageCreated(result.message.conversationId, result.message);
    await this.conversations.publish(result.message.conversationId);

    return {
      messageId: result.message.id,
      conversationId: result.message.conversationId,
      customerId,
      duplicate: false,
      conversationCreated: result.created,
    };
  }

  private async findByExternalId(
    externalId: string | null | undefined,
  ): Promise<InboundResult | null> {
    if (!externalId) {
      return null;
    }

    const existing = await this.db.message.findFirst({
      where: { externalId },
      select: { id: true, conversationId: true, conversation: { select: { customerId: true } } },
    });

    return existing
      ? {
          messageId: existing.id,
          conversationId: existing.conversationId,
          customerId: existing.conversation.customerId,
          duplicate: true,
          conversationCreated: false,
        }
      : null;
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
