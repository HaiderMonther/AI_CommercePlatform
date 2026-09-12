import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { ERROR_CODE, ErrorCode } from '../constants/error-codes.constant';
import { AppClsStore, CLS_KEYS } from '../context/request-context';
import { AppException } from '../exceptions/app.exception';

interface NormalizedError {
  status: number;
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}

/**
 * Converts every thrown value into the single error envelope documented in API.md.
 * Internal details (stack traces, SQL, Prisma metadata) are logged but never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly cls: ClsService<AppClsStore>) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = this.cls.getId?.() ?? this.cls.get(CLS_KEYS.CORRELATION_ID);

    const normalized = this.normalize(exception);

    if (normalized.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${correlationId}] ${request.method} ${request.url} -> ${normalized.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `[${correlationId}] ${request.method} ${request.url} -> ${normalized.status} ${normalized.code}`,
      );
    }

    response.status(normalized.status).json({
      success: false,
      message: normalized.message,
      code: normalized.code,
      data: null,
      ...(normalized.details ? { details: normalized.details } : {}),
      correlationId,
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ERROR_CODE.VALIDATION_FAILED,
        message: 'البيانات المرسلة غير صالحة',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODE.INTERNAL_ERROR,
      message: 'حدث خطأ غير متوقع، الرجاء المحاولة لاحقاً',
    };
  }

  private fromHttpException(exception: HttpException): NormalizedError {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { status, code: this.codeForStatus(status), message: payload };
    }

    const body = payload as Record<string, unknown>;

    // ValidationPipe returns { message: string[] , error, statusCode }
    if (Array.isArray(body.message)) {
      return {
        status,
        code: ERROR_CODE.VALIDATION_FAILED,
        message: 'البيانات المرسلة غير صالحة',
        details: body.message,
      };
    }

    return {
      status,
      code: (body.code as string) ?? this.codeForStatus(status),
      message: (body.message as string) ?? this.messageForStatus(status),
      details: body.details,
    };
  }

  private fromPrismaError(exception: Prisma.PrismaClientKnownRequestError): NormalizedError {
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta?.target as string[] | undefined)?.join(', ');
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODE.CONFLICT,
          message: 'القيمة المدخلة مستخدمة مسبقاً',
          details: target ? { fields: target } : undefined,
        };
      }
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ERROR_CODE.VALIDATION_FAILED,
          message: 'مرجع غير صالح في البيانات المرسلة',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ERROR_CODE.NOT_FOUND,
          message: 'العنصر غير موجود',
        };
      default:
        this.logger.error(`Unhandled Prisma error ${exception.code}: ${exception.message}`);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODE.INTERNAL_ERROR,
          message: 'حدث خطأ في قاعدة البيانات',
        };
    }
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODE.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODE.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODE.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODE.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODE.RATE_LIMITED;
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODE.VALIDATION_FAILED;
      default:
        return ERROR_CODE.INTERNAL_ERROR;
    }
  }

  private messageForStatus(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 'الرجاء تسجيل الدخول';
      case HttpStatus.FORBIDDEN:
        return 'ليس لديك صلاحية لتنفيذ هذه العملية';
      case HttpStatus.NOT_FOUND:
        return 'العنصر غير موجود';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'عدد المحاولات كبير، الرجاء المحاولة بعد قليل';
      default:
        return 'حدث خطأ غير متوقع';
    }
  }
}
