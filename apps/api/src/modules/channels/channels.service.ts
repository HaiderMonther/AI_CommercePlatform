import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChannelStatus,
  ChannelType,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import {
  BadRequestAppException,
  ConflictAppException,
  InternalAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { decryptSecret, encryptSecret } from '@common/utils/crypto.util';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';
import { GraphApiError, GraphChannel, MetaGraphClient } from './meta-graph.client';

/** Shape of `ChannelConnection.credentials`. The token is AES-256-GCM encrypted. */
interface StoredCredentials {
  accessToken: string;
  /** Last characters of the token, so an operator can tell which one is installed. */
  tokenHint: string;
}

/** Webhook path per channel, relative to the API prefix. */
export const WEBHOOK_PATHS: Record<ChannelType, string> = {
  WHATSAPP: 'webhooks/whatsapp',
  INSTAGRAM: 'webhooks/instagram',
  FACEBOOK: 'webhooks/facebook',
};

const CHANNEL_SELECT = {
  id: true,
  type: true,
  name: true,
  externalId: true,
  status: true,
  lastError: true,
  lastSyncAt: true,
  isActive: true,
  credentials: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { conversations: true } },
} as const satisfies Prisma.ChannelConnectionSelect;

type ChannelRow = Prisma.ChannelConnectionGetPayload<{ select: typeof CHANNEL_SELECT }>;

/** A connection ready to call the Graph API with. */
export interface ResolvedChannel extends GraphChannel {
  id: string;
}

/**
 * The company's connections to WhatsApp, Messenger and Instagram.
 *
 * Tokens are encrypted before they reach the database and never leave the API: views
 * carry only a hint of the last characters.
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
    private readonly audit: AuditService,
    private readonly graph: MetaGraphClient,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll() {
    const rows = await this.db.channelConnection.findMany({
      select: CHANNEL_SELECT,
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.toView(row));
  }

  async findOne(id: string) {
    const row = await this.db.channelConnection.findFirst({
      where: { id },
      select: CHANNEL_SELECT,
    });
    if (!row) {
      throw new NotFoundAppException('القناة غير موجودة', ERROR_CODE.CHANNEL_NOT_FOUND);
    }
    return this.toView(row);
  }

  /** Adds a connection and checks the token against Meta straight away. */
  async create(dto: CreateChannelDto) {
    const companyId = this.requireCompanyId();
    await this.assertAccountFree(dto.type, dto.externalId, companyId);

    let created: { id: string };
    try {
      created = await this.db.channelConnection.create({
        data: {
          companyId,
          type: dto.type,
          name: dto.name,
          externalId: dto.externalId,
          credentials: this.sealCredentials(dto.accessToken),
          status: ChannelStatus.DISCONNECTED,
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.alreadyConnected();
      }
      throw error;
    }

    await this.verify(created.id);
    const view = await this.findOne(created.id);

    await this.audit.record({
      action: AUDIT_ACTION.CREATE,
      entity: AUDIT_ENTITY.CHANNEL,
      entityId: created.id,
      newValue: view,
    });

    return view;
  }

  async update(id: string, dto: UpdateChannelDto) {
    const before = await this.findOne(id);

    await this.db.channelConnection.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.accessToken !== undefined
          ? {
              credentials: this.sealCredentials(dto.accessToken),
              status: ChannelStatus.DISCONNECTED,
            }
          : {}),
      },
    });

    if (dto.accessToken !== undefined) {
      await this.verify(id);
    }

    const after = await this.findOne(id);

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.CHANNEL,
      entityId: id,
      oldValue: before,
      newValue: { ...after, tokenReplaced: dto.accessToken !== undefined },
    });

    return after;
  }

  /** Conversations stay; they lose the link to this connection and fall back to the default. */
  async remove(id: string): Promise<void> {
    const channel = await this.findOne(id);
    await this.db.channelConnection.delete({ where: { id } });

    await this.audit.record({
      action: AUDIT_ACTION.DELETE,
      entity: AUDIT_ENTITY.CHANNEL,
      entityId: id,
      oldValue: channel,
    });
  }

  /** Calls Meta with the stored token and records whether the connection works. */
  async verify(id: string) {
    const row = await this.db.channelConnection.findFirst({
      where: { id },
      select: { id: true, type: true, externalId: true, credentials: true },
    });
    if (!row) {
      throw new NotFoundAppException('القناة غير موجودة', ERROR_CODE.CHANNEL_NOT_FOUND);
    }

    try {
      const accountName = await this.graph.describeAccount({
        type: row.type,
        externalId: row.externalId,
        accessToken: this.openCredentials(row.credentials),
      });
      await this.markHealthy(id);
      this.logger.log(`Channel ${id} verified as "${accountName}"`);
    } catch (error) {
      const message =
        error instanceof GraphApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      await this.markError(id, message);
    }

    return this.findOne(id);
  }

  // ---------------------------------------------------------------------------------
  // Used by the webhook and delivery workers, outside any request context.
  // ---------------------------------------------------------------------------------

  /** Connections for the business accounts named in a webhook delivery, across tenants. */
  findByAccounts(accounts: { type: ChannelType; externalId: string }[]) {
    if (accounts.length === 0) return Promise.resolve([]);

    return this.prisma.channelConnection.findMany({
      where: { OR: accounts.map(({ type, externalId }) => ({ type, externalId })) },
      select: { id: true, companyId: true, type: true, externalId: true, isActive: true },
    });
  }

  /**
   * The connection a reply goes out through: the one the conversation came in on, or else
   * the company's first active connection of that type (for conversations started from
   * the dashboard).
   */
  async resolveForOutbound(
    companyId: string,
    type: ChannelType,
    preferredId: string | null,
  ): Promise<ResolvedChannel | null> {
    const candidates = await this.prisma.channelConnection.findMany({
      where: { companyId, type, isActive: true },
      select: { id: true, type: true, externalId: true, credentials: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    const chosen =
      candidates.find((candidate) => candidate.id === preferredId) ??
      candidates.find((candidate) => candidate.status === ChannelStatus.CONNECTED) ??
      candidates[0];

    if (!chosen) return null;

    return {
      id: chosen.id,
      type: chosen.type,
      externalId: chosen.externalId,
      accessToken: this.openCredentials(chosen.credentials),
    };
  }

  async markHealthy(id: string): Promise<void> {
    await this.prisma.channelConnection.update({
      where: { id },
      data: { status: ChannelStatus.CONNECTED, lastError: null, lastSyncAt: new Date() },
    });
  }

  async markError(id: string, message: string): Promise<void> {
    const channel = await this.prisma.channelConnection.update({
      where: { id },
      data: { status: ChannelStatus.ERROR, lastError: message.slice(0, 500) },
      select: { name: true },
    });

    await this.notifications.notify({
      type: NotificationType.CHANNEL_ERROR,
      title: `تعطّلت القناة: ${channel.name}`,
      body: 'تعذّر الإرسال عبر هذه القناة. تحقق من رمز الوصول في إعدادات القنوات.',
      data: { channelId: id },
      permission: PERMISSIONS.CHANNELS_MANAGE,
      dedupe: { key: 'channelId', withinMs: 6 * 60 * 60_000 },
    });
  }

  async touch(id: string): Promise<void> {
    await this.prisma.channelConnection.update({ where: { id }, data: { lastSyncAt: new Date() } });
  }

  // ---------------------------------------------------------------------------------

  private async assertAccountFree(type: ChannelType, externalId: string, companyId: string) {
    const existing = await this.prisma.channelConnection.findUnique({
      where: { type_externalId: { type, externalId } },
      select: { companyId: true },
    });

    if (existing) {
      throw existing.companyId === companyId
        ? new ConflictAppException('هذا الحساب مضاف مسبقاً', ERROR_CODE.CHANNEL_ALREADY_CONNECTED)
        : this.alreadyConnected();
    }
  }

  private alreadyConnected(): ConflictAppException {
    // One business account delivers webhooks to one tenant; two would split its messages.
    return new ConflictAppException(
      'هذا الحساب مربوط بمتجر آخر على المنصة',
      ERROR_CODE.CHANNEL_ALREADY_CONNECTED,
    );
  }

  private sealCredentials(accessToken: string): Prisma.InputJsonValue {
    const credentials: StoredCredentials = {
      accessToken: encryptSecret(accessToken, this.encryptionKey()),
      tokenHint: accessToken.slice(-4),
    };
    return credentials as unknown as Prisma.InputJsonValue;
  }

  private openCredentials(value: Prisma.JsonValue): string {
    const credentials = value as unknown as StoredCredentials | null;
    if (!credentials?.accessToken) {
      throw new BadRequestAppException(
        'لا يوجد رمز وصول لهذه القناة',
        ERROR_CODE.CHANNEL_NOT_CONFIGURED,
      );
    }
    return decryptSecret(credentials.accessToken, this.encryptionKey());
  }

  private encryptionKey(): string {
    const key = this.config.get<string>('security.encryptionKey');
    if (!key) {
      throw new InternalAppException(
        'مفتاح التشفير ENCRYPTION_KEY غير مضبوط على الخادم',
        ERROR_CODE.CHANNEL_NOT_CONFIGURED,
      );
    }
    return key;
  }

  private toView(row: ChannelRow) {
    const { credentials, _count, ...rest } = row;
    const stored = credentials as unknown as StoredCredentials | null;

    return {
      ...rest,
      hasAccessToken: Boolean(stored?.accessToken),
      tokenHint: stored?.tokenHint ? `…${stored.tokenHint}` : null,
      conversationsCount: _count.conversations,
      webhookPath: WEBHOOK_PATHS[row.type],
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
