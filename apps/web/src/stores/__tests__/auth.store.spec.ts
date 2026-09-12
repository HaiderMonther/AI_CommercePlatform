import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../auth.store';
import type { AuthUser } from '@/types/auth';

const buildUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 'user-1',
  email: 'agent@demo.iq',
  fullName: 'مندوب',
  avatarUrl: null,
  companyId: 'company-1',
  isPlatformAdmin: false,
  roleKey: 'SALES_AGENT',
  roleName: 'مندوب مبيعات',
  permissions: ['orders.read', 'orders.create'],
  ...overrides,
});

describe('auth store permissions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('denies everything when nobody is signed in', () => {
    const auth = useAuthStore();
    expect(auth.can('orders.read')).toBe(false);
    expect(auth.canAny(['orders.read'])).toBe(false);
  });

  it('grants a permission the user holds', () => {
    const auth = useAuthStore();
    auth.user = buildUser();
    expect(auth.can('orders.read')).toBe(true);
  });

  it('denies a permission the user does not hold', () => {
    const auth = useAuthStore();
    auth.user = buildUser();
    expect(auth.can('users.delete')).toBe(false);
  });

  it('requires every permission when given a list', () => {
    const auth = useAuthStore();
    auth.user = buildUser();
    expect(auth.can(['orders.read', 'orders.create'])).toBe(true);
    expect(auth.can(['orders.read', 'users.delete'])).toBe(false);
  });

  it('canAny passes when at least one matches', () => {
    const auth = useAuthStore();
    auth.user = buildUser();
    expect(auth.canAny(['users.delete', 'orders.read'])).toBe(true);
    expect(auth.canAny(['users.delete'])).toBe(false);
  });

  it('lets a platform admin through regardless of the permission list', () => {
    const auth = useAuthStore();
    auth.user = buildUser({ isPlatformAdmin: true, permissions: [] });
    expect(auth.can('users.delete')).toBe(true);
  });

  it('clears identity and stored tokens on logout', () => {
    const auth = useAuthStore();
    auth.user = buildUser();
    auth.clear();

    expect(auth.user).toBeNull();
    expect(auth.accessToken).toBeNull();
    expect(localStorage.getItem('aicp.accessToken')).toBeNull();
  });
});
