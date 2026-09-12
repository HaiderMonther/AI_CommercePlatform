import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from '../constants/permissions.constant';

export const PERMISSIONS_KEY = 'auth:permissions';

/** Requires the caller to hold every listed permission. */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const PLATFORM_ADMIN_KEY = 'auth:platformAdmin';

/** Restricts a route to platform (super admin) users. */
export const PlatformAdminOnly = () => SetMetadata(PLATFORM_ADMIN_KEY, true);
