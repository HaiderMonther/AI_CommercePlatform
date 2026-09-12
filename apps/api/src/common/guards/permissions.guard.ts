import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODE } from '../constants/error-codes.constant';
import { PermissionKey } from '../constants/permissions.constant';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY, PLATFORM_ADMIN_KEY } from '../decorators/permissions.decorator';
import { ForbiddenAppException } from '../exceptions/app.exception';
import { AuthenticatedUser } from '../types/authenticated-user.type';

/**
 * RBAC enforcement. Permissions are resolved once at authentication time and carried on
 * the request principal, so authorization costs no extra database round trip.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenAppException('الرجاء تسجيل الدخول', ERROR_CODE.UNAUTHENTICATED);
    }

    if (platformOnly && !user.isPlatformAdmin) {
      throw new ForbiddenAppException('هذه العملية مخصصة لمدير المنصة فقط');
    }

    if (!required || required.length === 0) {
      return true;
    }

    if (user.isPlatformAdmin) {
      return true;
    }

    const granted = new Set(user.permissions);
    const missing = required.filter((permission) => !granted.has(permission));

    if (missing.length > 0) {
      throw new ForbiddenAppException(
        'ليس لديك صلاحية لتنفيذ هذه العملية',
        ERROR_CODE.PERMISSION_DENIED,
      );
    }

    return true;
  }
}
