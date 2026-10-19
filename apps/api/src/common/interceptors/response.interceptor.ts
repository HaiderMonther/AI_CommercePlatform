import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Observable, map } from 'rxjs';
import { AppClsStore } from '../context/request-context';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

export interface ApiEnvelope<T> {
  success: true;
  message: string;
  data: T;
  correlationId?: string;
}

const DEFAULT_MESSAGE = 'تمت العملية بنجاح';

/** Wraps every successful controller return value in the uniform response envelope. */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T>> {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T>> {
    // Realtime acknowledgements carry their own small `{ ok, code }` shape.
    if (context.getType() !== 'http') {
      return next.handle() as unknown as Observable<ApiEnvelope<T>>;
    }

    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_MESSAGE;

    return next.handle().pipe(
      // A file download is the response itself; wrapping it would corrupt it.
      map((data) =>
        data instanceof StreamableFile
          ? (data as unknown as ApiEnvelope<T>)
          : {
              success: true as const,
              message,
              data: data ?? (null as unknown as T),
              correlationId: this.cls.getId?.(),
            },
      ),
    );
  }
}
