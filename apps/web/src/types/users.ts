export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  nameAr: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  roleId: string | null;
  role: RoleSummary | null;
}

export interface CreateUserPayload {
  email: string;
  fullName: string;
  password: string;
  roleId: string;
  phone?: string;
  status?: UserStatus;
}

export interface UpdateUserPayload {
  fullName?: string;
  phone?: string;
  roleId?: string;
  status?: UserStatus;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  nameAr: string;
  description: string | null;
  isSystem: boolean;
  usersCount: number;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PermissionGroup {
  group: string;
  groupLabel: string;
  permissions: { key: string; description: string }[];
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  status: string;
  planTier: string;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyStats {
  companyId: string;
  users: number;
  products: number;
  customers: number;
  orders: number;
  channels: number;
}

export interface AuditLog {
  id: string;
  companyId: string | null;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
  correlationId: string | null;
  createdAt: string;
  user: { id: string; fullName: string; email: string } | null;
}
