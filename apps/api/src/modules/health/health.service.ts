import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  checks: Record<string, { status: 'up' | 'down'; latencyMs?: number; error?: string }>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthReport> {
    const database = await this.checkDatabase();

    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: { database },
    };
  }

  private async checkDatabase(): Promise<HealthReport['checks'][string]> {
    const startedAt = Date.now();
    try {
      await this.prisma.ping();
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      this.logger.error('Database health check failed', error instanceof Error ? error.stack : error);
      return { status: 'down', error: 'unreachable' };
    }
  }
}
