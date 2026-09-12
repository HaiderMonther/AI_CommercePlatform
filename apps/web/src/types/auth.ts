export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  companyId: string | null;
  isPlatformAdmin: boolean;
  roleKey: string | null;
  roleName: string | null;
  permissions: string[];
}

export interface AuthCompany {
  id: string;
  name: string;
  slug: string;
  currency: string;
  status: string;
  planTier: string;
  logoUrl: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  user: AuthUser;
  company: AuthCompany | null;
  tokens: AuthTokens;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  companyName: string;
  fullName: string;
  email: string;
  password: string;
  phone?: string;
}
