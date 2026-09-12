/** The principal attached to a request after the JWT strategy validates the token. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  companyId: string | null;
  isPlatformAdmin: boolean;
  roleId: string | null;
  roleKey: string | null;
  permissions: string[];
}

export interface AccessTokenPayload {
  /** user id */
  sub: string;
  email: string;
  companyId: string | null;
  isPlatformAdmin: boolean;
  roleId: string | null;
  /** token type discriminator, guards against using a refresh token as an access token */
  typ: 'access';
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  /** rotation family, lets us revoke an entire device session on reuse */
  fid: string;
  jti: string;
  typ: 'refresh';
  iat?: number;
  exp?: number;
}
