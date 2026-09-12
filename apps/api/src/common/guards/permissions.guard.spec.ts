import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '../constants/permissions.constant';
import { AppException } from '../exceptions/app.exception';
import { AuthenticatedUser } from '../types/authenticated-user.type';
import { PermissionsGuard } from './permissions.guard';

const buildContext = (user?: Partial<AuthenticatedUser>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  }) as unknown as ExecutionContext;

const buildUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'user@demo.iq',
  fullName: 'مستخدم',
  companyId: 'company-1',
  isPlatformAdmin: false,
  roleId: 'role-1',
  roleKey: 'SALES_AGENT',
  permissions: [PERMISSIONS.ORDERS_READ],
  ...overrides,
});

describe('PermissionsGuard', () => {
  let reflector: jest.Mocked<Reflector>;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as jest.Mocked<Reflector>;
    guard = new PermissionsGuard(reflector);
  });

  const metadata = (values: { isPublic?: boolean; platformOnly?: boolean; required?: string[] }) => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(values.isPublic)
      .mockReturnValueOnce(values.platformOnly)
      .mockReturnValueOnce(values.required);
  };

  it('allows public routes without a principal', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(true);
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('allows a route with no declared permissions for any authenticated user', () => {
    metadata({ required: undefined });
    expect(guard.canActivate(buildContext(buildUser()))).toBe(true);
  });

  it('allows a user holding every required permission', () => {
    metadata({ required: [PERMISSIONS.ORDERS_READ] });
    expect(guard.canActivate(buildContext(buildUser()))).toBe(true);
  });

  it('rejects a user missing one of the required permissions', () => {
    metadata({ required: [PERMISSIONS.ORDERS_READ, PERMISSIONS.ORDERS_DELETE] });

    expect(() => guard.canActivate(buildContext(buildUser()))).toThrow(AppException);
  });

  it('rejects an unauthenticated request on a protected route', () => {
    metadata({ required: [PERMISSIONS.ORDERS_READ] });

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(AppException);
  });

  it('lets a platform admin through any tenant permission check', () => {
    metadata({ required: [PERMISSIONS.ORDERS_DELETE] });

    const user = buildUser({ isPlatformAdmin: true, permissions: [] });
    expect(guard.canActivate(buildContext(user))).toBe(true);
  });

  it('blocks a tenant user from a platform-only route', () => {
    metadata({ platformOnly: true, required: [] });

    expect(() => guard.canActivate(buildContext(buildUser()))).toThrow(AppException);
  });
});
