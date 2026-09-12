import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { Observable, tap } from 'rxjs';
import { AppClsStore, CLS_KEYS } from '../context/request-context';

const SLOW_REQUEST_MS = 1000;

/**
 * Structured access log. Every line carries the correlation id, tenant and user so a
 * request can be traced end to end across the API, the queues and the channel providers.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly cls: ClsService<AppClsStore>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.write(request, response.statusCode, startedAt),
        error: (error: { status?: number }) => this.write(request, error?.status ?? 500, startedAt),
      }),
    );
  }

  private write(request: Request, statusCode: number, startedAt: number): void {
    const durationMs = Date.now() - startedAt;
    const entry = {
      correlationId: this.cls.getId?.(),
      method: request.method,
      path: request.originalUrl ?? request.url,
      statusCode,
      durationMs,
      companyId: this.cls.get(CLS_KEYS.COMPANY_ID),
      userId: this.cls.get(CLS_KEYS.USER_ID),
      ip: this.cls.get(CLS_KEYS.IP_ADDRESS),
    };

    const line = JSON.stringify(entry);
    if (statusCode >= 500) {
      this.logger.error(line);
    } else if (durationMs > SLOW_REQUEST_MS || statusCode >= 400) {
      this.logger.warn(line);
    } else {
      this.logger.log(line);
    }
  }
}
