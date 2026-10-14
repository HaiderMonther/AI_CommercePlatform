import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiConfig, ChannelType, Prisma } from '@prisma/client';
import { AiProviderConfig } from '@common/config/configuration';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { AppException, BadRequestAppException } from '@common/exceptions/app.exception';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { AiAgentService } from './ai-agent.service';
import { AgentProfile, buildHistory } from './ai-prompt';
import { AI_MODELS, AI_MODEL_IDS, LANGUAGES, TONES } from './ai.constants';
import { TestAiDto, UpdateAiConfigDto } from './dto/ai-config.dto';

export interface LoadedAiConfig {
  config: AiConfig;
  profile: AgentProfile;
  /** The configured model, or the platform default when the stored one is not offered. */
  model: string;
}

const CONFIG_SELECT = {
  id: true,
  enabled: true,
  autoReply: true,
  businessName: true,
  businessDescription: true,
  tone: true,
  language: true,
  currency: true,
  workingHours: true,
  returnPolicy: true,
  deliveryPolicy: true,
  paymentMethods: true,
  customInstructions: true,
  model: true,
  handoverKeywords: true,
  updatedAt: true,
} as const satisfies Prisma.AiConfigSelect;

@Injectable()
export class AiSettingsService {
  private readonly provider: AiProviderConfig;

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly context: TenantContextService,
    private readonly audit: AuditService,
    private readonly agent: AiAgentService,
    config: ConfigService,
  ) {
    this.provider = config.getOrThrow<AiProviderConfig>('ai');
  }

  async get() {
    const { config } = await this.load();
    return this.toView(config);
  }

  async update(dto: UpdateAiConfigDto) {
    const { config: before } = await this.load();

    const data: Prisma.AiConfigUpdateInput = {
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      ...(dto.autoReply !== undefined ? { autoReply: dto.autoReply } : {}),
      ...(dto.businessName !== undefined ? { businessName: dto.businessName } : {}),
      ...(dto.businessDescription !== undefined
        ? { businessDescription: dto.businessDescription || null }
        : {}),
      ...(dto.tone !== undefined ? { tone: dto.tone } : {}),
      ...(dto.language !== undefined ? { language: dto.language } : {}),
      ...(dto.workingHours !== undefined
        ? { workingHours: dto.workingHours ? { text: dto.workingHours } : Prisma.DbNull }
        : {}),
      ...(dto.returnPolicy !== undefined ? { returnPolicy: dto.returnPolicy || null } : {}),
      ...(dto.deliveryPolicy !== undefined ? { deliveryPolicy: dto.deliveryPolicy || null } : {}),
      ...(dto.paymentMethods !== undefined
        ? { paymentMethods: [...new Set(dto.paymentMethods)] }
        : {}),
      ...(dto.customInstructions !== undefined
        ? { customInstructions: dto.customInstructions || null }
        : {}),
      ...(dto.model !== undefined ? { model: dto.model } : {}),
      ...(dto.handoverKeywords !== undefined
        ? {
            handoverKeywords: [
              ...new Set(dto.handoverKeywords.map((keyword) => keyword.trim()).filter(Boolean)),
            ],
          }
        : {}),
    };

    const updated = await this.db.aiConfig.update({ where: { id: before.id }, data });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.AI_CONFIG,
      entityId: before.id,
      oldValue: this.toView(before),
      newValue: dto,
    });

    return this.toView(updated);
  }

  /**
   * Runs the agent on a sample conversation with the current settings, from the settings
   * page. Read tools run for real against the catalog; create_order validates without
   * placing anything and a handover is only reported.
   */
  async test(dto: TestAiDto) {
    if (!this.agent.configured) {
      throw new AppException(
        ERROR_CODE.AI_NOT_CONFIGURED,
        'المساعد الذكي غير مفعّل على الخادم (مفتاح AI_API_KEY غير مضبوط)',
        503,
      );
    }

    const { profile, model } = await this.load();
    const history = buildHistory([
      ...(dto.history ?? []).map((turn) => ({
        senderType: turn.role === 'customer' ? ('CUSTOMER' as const) : ('AI' as const),
        content: turn.content,
      })),
      { senderType: 'CUSTOMER' as const, content: dto.message },
    ]);

    if (!history) {
      throw new BadRequestAppException('اكتب رسالة الزبون للتجربة');
    }

    const result = await this.agent.run({
      companyId: this.requireCompanyId(),
      model,
      profile,
      customer: {
        name: 'زبون تجريبي',
        phone: null,
        city: null,
        address: null,
        channel: ChannelType.WHATSAPP,
        recentOrders: [],
      },
      history,
      // A customer id that matches nothing: order lookups come back empty.
      tools: { customerId: 'test-customer', conversationId: null, dryRun: true },
    });

    if (!result.success) {
      throw new AppException(
        ERROR_CODE.AI_PROVIDER_ERROR,
        `تعذّر تشغيل المساعد: ${result.error}`,
        502,
      );
    }

    return {
      reply: result.reply,
      handoverReason: result.handoverReason,
      toolCalls: result.toolCalls,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
    };
  }

  /** The company's AI settings, created with defaults the first time they are needed. */
  async load(): Promise<LoadedAiConfig> {
    const companyId = this.requireCompanyId();

    const company = await this.db.company.findFirstOrThrow({
      where: { id: companyId },
      select: { name: true, currency: true, phone: true, city: true, address: true },
    });

    const config =
      (await this.db.aiConfig.findFirst({ where: { companyId } })) ??
      (await this.db.aiConfig.create({
        data: {
          companyId,
          businessName: company.name,
          currency: company.currency,
          model: this.provider.defaultModel,
          paymentMethods: ['CASH_ON_DELIVERY'],
          handoverKeywords: ['موظف', 'شكوى', 'مدير'],
        },
      }));

    return {
      config,
      model: (AI_MODEL_IDS as string[]).includes(config.model)
        ? config.model
        : this.provider.defaultModel,
      profile: {
        businessName: config.businessName?.trim() || company.name,
        businessDescription: config.businessDescription,
        tone: config.tone,
        language: config.language,
        currency: config.currency || company.currency,
        workingHours: config.workingHours,
        returnPolicy: config.returnPolicy,
        deliveryPolicy: config.deliveryPolicy,
        paymentMethods: config.paymentMethods,
        customInstructions: config.customInstructions,
        company: { phone: company.phone, city: company.city, address: company.address },
      },
    };
  }

  private toView(config: AiConfig) {
    const picked = Object.fromEntries(
      Object.keys(CONFIG_SELECT).map((key) => [key, config[key as keyof AiConfig]]),
    ) as Pick<AiConfig, keyof typeof CONFIG_SELECT>;

    const hours = config.workingHours as { text?: string } | string | null;

    return {
      ...picked,
      workingHours: typeof hours === 'string' ? hours : (hours?.text ?? null),
      providerConfigured: this.agent.configured,
      options: {
        models: AI_MODELS,
        tones: Object.keys(TONES),
        languages: Object.keys(LANGUAGES),
      },
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
