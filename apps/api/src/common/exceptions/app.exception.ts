import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODE, ErrorCode } from '../constants/error-codes.constant';

export interface AppExceptionPayload {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Base application exception. Every thrown error carries a stable `code` plus an
 * Arabic, user-facing `message`, so the API never leaks internal failure text.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status: HttpStatus, details?: unknown) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }
}

export class BadRequestAppException extends AppException {
  constructor(message: string, code: ErrorCode = ERROR_CODE.VALIDATION_FAILED, details?: unknown) {
    super(code, message, HttpStatus.BAD_REQUEST, details);
  }
}

export class UnauthorizedAppException extends AppException {
  constructor(message = 'الرجاء تسجيل الدخول', code: ErrorCode = ERROR_CODE.UNAUTHENTICATED) {
    super(code, message, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenAppException extends AppException {
  constructor(message = 'ليس لديك صلاحية لتنفيذ هذه العملية', code: ErrorCode = ERROR_CODE.FORBIDDEN) {
    super(code, message, HttpStatus.FORBIDDEN);
  }
}

export class NotFoundAppException extends AppException {
  constructor(message = 'العنصر غير موجود', code: ErrorCode = ERROR_CODE.NOT_FOUND) {
    super(code, message, HttpStatus.NOT_FOUND);
  }
}

export class ConflictAppException extends AppException {
  constructor(message: string, code: ErrorCode = ERROR_CODE.CONFLICT, details?: unknown) {
    super(code, message, HttpStatus.CONFLICT, details);
  }
}

export class InternalAppException extends AppException {
  constructor(message = 'حدث خطأ غير متوقع', code: ErrorCode = ERROR_CODE.INTERNAL_ERROR) {
    super(code, message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
