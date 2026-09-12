import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '@common/context/tenant-context.service';
import { PaginatedResult, paginate } from '@common/dto/pagination.dto';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { AuditAction, AuditEntity } from './audit.constants';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

export interface AuditRecordInput {
  action: AuditAction | string;
  entity: AuditEntity | string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  /** Overrides the tenant from the request context (used by background workers). */
  companyId?: string | null;
  userId?: string | null;
}

const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'refreshToken',
  'accessToken',
  'credentials',
  'webhookSecret',
]);

/**
 * Append-only trail of every sensitive mutation. Writes never throw into the caller:
 * losing an audit line must not roll back a business operation, but it is logged loudly.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly context: TenantContextService,
  ) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.db.auditLog.create({
        data: {
          companyId: input.companyId ?? this.context.getRawCompanyId() ?? null,
          userId: input.userId ?? this.context.getUserId() ?? null,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId ?? null,
          oldValue: this.sanitize(input.oldValue),
          newValue: this.sanitize(input.newValue),
          ipAddress: this.context.getIpAddress() ?? null,
          userAgent: this.context.getUserAgent() ?? null,
          correlationId: this.context.getCorrelationId() ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for ${input.action} ${input.entity}:${input.entityId ?? '-'}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async findAll(query: QueryAuditLogsDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        orderBy: { createdAt: query.sortOrder },
        skip: query.skip,
        take: query.limit,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.db.auditLog.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  /** Strips secrets before an entity snapshot is persisted to the trail. */
  private sanitize(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'object') {
      return value as Prisma.InputJsonValue;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item)) as Prisma.InputJsonValue;
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_FIELDS.has(key) ? '[REDACTED]' : this.sanitize(item);
    }
    return result as Prisma.InputJsonValue;
  }
}
