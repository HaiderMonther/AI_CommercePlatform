import { http, unwrap } from './http';
import type { LoginPayload, LoginResponse, RegisterPayload } from '@/types/auth';
import type { AuthCompany, AuthUser } from '@/types/auth';

export const authService = {
  login: (payload: LoginPayload) =>
    unwrap<LoginResponse>(http.post('/auth/login', payload)),

  register: (payload: RegisterPayload) =>
    unwrap<LoginResponse>(http.post('/auth/register', payload)),

  refresh: (refreshToken: string) =>
    unwrap<LoginResponse>(http.post('/auth/refresh', { refreshToken })),

  logout: (refreshToken: string | null) =>
    unwrap<null>(http.post('/auth/logout', refreshToken ? { refreshToken } : {})),

  me: () => unwrap<{ user: AuthUser; company: AuthCompany | null }>(http.get('/auth/me')),

  changePassword: (currentPassword: string, newPassword: string) =>
    unwrap<null>(http.post('/auth/change-password', { currentPassword, newPassword })),
};
