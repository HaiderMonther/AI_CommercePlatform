import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ERROR_CODE } from '../constants/error-codes.constant';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UnauthorizedAppException } from '../exceptions/app.exception';
import { AuthenticatedUser } from '../types/authenticated-user.type';

/** Applied globally; routes opt out with @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | false,
    info: { name?: string } | undefined,
  ): TUser {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedAppException('انتهت صلاحية الجلسة', ERROR_CODE.TOKEN_EXPIRED);
      }
      throw new UnauthorizedAppException('الرجاء تسجيل الدخول', ERROR_CODE.UNAUTHENTICATED);
    }
    return user;
  }
}
