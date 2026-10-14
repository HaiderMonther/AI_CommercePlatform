import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationMode, ConversationStatus, CustomerStatus, SenderType } from '@prisma/client';
import { AiProviderConfig } from '@common/config/configuration';
import { TenantContextService } from '@common/context/tenant-context.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { MessagesService } from '@modules/messages/messages.service';
import { AiAgentService } from './ai-agent.service';
import { buildHistory, matchHandoverKeyword } from './ai-prompt';
import { AiSettingsService } from './ai-settings.service';
import { HANDOVER, HANDOVER_REPLY, HISTORY_LIMIT, REPLY_LEASE_MS } from './ai.constants';

/** Customer messages that arrive while a reply is being written are answered with it. */
const MAX_CATCH_UP_ROUNDS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decides when the AI answers a customer, and acts on what it decides.
 *
 * Only one reply is written per conversation at a time: a lease on the conversation row
 * (`aiLockedUntil`) is taken in one UPDATE, so two API instances processing two webhooks
 * of the same burst cannot both answer. Messages that arrive while the holder is working
 * are picked up by the holder before it lets go, and checked once more after release so
 * none slips between the last check and the release.
 */
@Injectable()
export class AiResponderService {
  private readonly logger = new Logger(AiResponderService.name);
  private readonly replyDelayMs: number;

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
    private readonly agent: AiAgentService,
    private readonly settings: AiSettingsService,
    private readonly messages: MessagesService,
    private readonly conversations: ConversationsService,
    config: ConfigService,
  ) {
    this.replyDelayMs = config.getOrThrow<AiProviderConfig>('ai').replyDelayMs;
  }

  /**
   * A customer message was recorded. Runs inside the tenant context of the caller and
   * never throws: a failed reply must not fail the webhook that delivered the message.
   */
  async onInbound(conversationId: string): Promise<void> {
    if (!this.agent.configured) return;

    try {
      // Customers often send a thought in several short messages; answer them together.
      if (this.replyDelayMs > 0) await sleep(this.replyDelayMs);

      await this.answer(conversationId);

      if (await this.hasUnanswered(conversationId)) {
        await this.answer(conversationId);
      }
    } catch (error) {
      this.logger.error(
        `AI reply for conversation ${conversationId} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async answer(conversationId: string): Promise<void> {
    if (!(await this.claim(conversationId))) return;

    try {
      for (let round = 0; round < MAX_CATCH_UP_ROUNDS; round++) {
        const done = await this.replyOnce(conversationId);
        if (done) return;
      }
    } finally {
      await this.release(conversationId);
    }
  }

  /** One attempt. Returns false when newer customer messages call for another round. */
  private async replyOnce(conversationId: string): Promise<boolean> {
    const state = await this.loadState(conversationId);
    if (!state) return true;

    const { conversation, history, lastCustomerMessage } = state;
    const { config, profile, model } = await this.settings.load();
    if (!config.enabled || !config.autoReply) return true;

    const keyword = matchHandoverKeyword(lastCustomerMessage.content, config.handoverKeywords);
    if (keyword) {
      await this.handOver(conversationId, HANDOVER.KEYWORD(keyword), HANDOVER_REPLY);
      return true;
    }

    const turns = buildHistory(history);
    if (!turns) return true;

    const result = await this.agent.run({
      companyId: this.requireCompanyId(),
      model,
      profile,
      customer: {
        name: conversation.customer.name,
        phone: conversation.customer.phone,
        city: conversation.customer.city,
        address: conversation.customer.address,
        channel: conversation.channel,
        recentOrders: conversation.customer.orders.map((order) => ({
          ...order,
          total: Number(order.total),
        })),
      },
      history: turns,
      tools: {
        customerId: conversation.customerId,
        conversationId,
        dryRun: false,
      },
    });

    // The world may have moved on while Claude was thinking.
    const now = await this.loadState(conversationId);
    if (!now) return true; // a person took over, or the conversation closed

    const newerArrived = now.lastCustomerMessage.id !== lastCustomerMessage.id;
    // A placed order or a handover has happened and must be told; a plain answer to an
    // outdated question is dropped and rewritten with the new messages.
    if (newerArrived && !result.handoverReason && result.orderIds.length === 0) {
      return false;
    }

    if (result.reply) {
      const message = await this.messages.recordAiReply(conversationId, result.reply);
      await this.prisma.aiInteraction.update({
        where: { id: result.interactionId },
        data: { messageId: message.id },
      });
    }

    if (result.handoverReason) {
      await this.handOver(
        conversationId,
        result.handoverReason,
        result.reply ? null : HANDOVER_REPLY,
      );
    }

    return true;
  }

  private async handOver(conversationId: string, reason: string, reply: string | null) {
    if (reply) {
      await this.messages.recordAiReply(conversationId, reply);
    }
    await this.conversations.setMode(conversationId, { mode: ConversationMode.HUMAN, reason });
    this.logger.log(`Conversation ${conversationId} handed to staff: ${reason}`);
  }

  /** The conversation if the AI may answer it now, with what it needs to do so. */
  private async loadState(conversationId: string) {
    const conversation = await this.db.conversation.findFirst({
      where: { id: conversationId },
      select: {
        id: true,
        customerId: true,
        channel: true,
        status: true,
        mode: true,
        customer: {
          select: {
            name: true,
            phone: true,
            city: true,
            address: true,
            status: true,
            deletedAt: true,
            orders: {
              select: { orderNumber: true, status: true, total: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 3,
            },
          },
        },
      },
    });

    if (
      !conversation ||
      conversation.mode !== ConversationMode.AI ||
      conversation.status === ConversationStatus.CLOSED ||
      conversation.customer.status !== CustomerStatus.ACTIVE ||
      conversation.customer.deletedAt
    ) {
      return null;
    }

    const recent = await this.db.message.findMany({
      where: { conversationId },
      select: { id: true, senderType: true, content: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
    });
    const history = recent.reverse();

    const lastCustomerMessage = [...history]
      .reverse()
      .find((message) => message.senderType === SenderType.CUSTOMER);
    if (!lastCustomerMessage) return null;

    return { conversation, history, lastCustomerMessage };
  }

  /** The newest message is the customer's and nobody has answered it. */
  private async hasUnanswered(conversationId: string): Promise<boolean> {
    const latest = await this.db.message.findFirst({
      where: { conversationId, senderType: { not: SenderType.SYSTEM } },
      select: { senderType: true, conversation: { select: { mode: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return (
      latest?.senderType === SenderType.CUSTOMER && latest.conversation.mode === ConversationMode.AI
    );
  }

  private async claim(conversationId: string): Promise<boolean> {
    const until = new Date(Date.now() + REPLY_LEASE_MS);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE conversations
      SET "aiLockedUntil" = ${until}
      WHERE id = ${conversationId}
        AND "companyId" = ${this.requireCompanyId()}
        AND ("aiLockedUntil" IS NULL OR "aiLockedUntil" < NOW())
      RETURNING id
    `;
    return rows.length > 0;
  }

  private async release(conversationId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE conversations SET "aiLockedUntil" = NULL
      WHERE id = ${conversationId} AND "companyId" = ${this.requireCompanyId()}
    `;
  }

  private requireCompanyId(): string {
    const companyId = this.context.getCompanyId();
    if (!companyId) throw new Error('AI responder needs a tenant context');
    return companyId;
  }
}
