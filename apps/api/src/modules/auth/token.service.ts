import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { UnauthorizedAppException } from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { sha256 } from '@common/utils/crypto.util';
import {
  AccessTokenPayload,
  AuthenticatedUser,
  RefreshTokenPayload,
} from '@common/types/authenticated-user.type';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Issues and rotates JWTs.
 *
 * Refresh tokens are opaque to the client but stored hashed, one row per issued token,
 * grouped into a `familyId` per device/session. Presenting an already-rotated token
 * (a classic replay after theft) revokes the whole family immediately.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issuePair(
    user: AuthenticatedUser,
    metadata: SessionMetadata,
    familyId: string = randomUUID(),
  ): Promise<TokenPair> {
    const accessToken = await this.signAccessToken(user);
    const jti = randomUUID();
    const refreshToken = await this.signRefreshToken(user.id, familyId, jti);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        userAgent: metadata.userAgent?.slice(0, 255) ?? null,
        ipAddress: metadata.ipAddress ?? null,
        expiresAt: this.refreshExpiryDate(),
      },
    });

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds() };
  }

  /**
   * Validates a presented refresh token and rotates it. Returns the user id and family
   * so the caller can re-resolve permissions before minting a new access token.
   */
  async rotate(presentedToken: string): Promise<{ userId: string; familyId: string }> {
    const payload = await this.verifyRefreshToken(presentedToken);
    const tokenHash = sha256(presentedToken);

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      // Token is signature-valid but unknown: it was already rotated away or forged.
      await this.revokeFamily(payload.fid);
      this.logger.warn(`Refresh token reuse detected for family ${payload.fid}`);
      throw new UnauthorizedAppException(
        'انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مرة أخرى',
        ERROR_CODE.REFRESH_TOKEN_REUSED,
      );
    }

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      this.logger.warn(`Revoked refresh token replayed for family ${stored.familyId}`);
      throw new UnauthorizedAppException(
        'انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مرة أخرى',
        ERROR_CODE.REFRESH_TOKEN_REUSED,
      );
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedAppException('انتهت صلاحية الجلسة', ERROR_CODE.TOKEN_EXPIRED);
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return { userId: stored.userId, familyId: stored.familyId };
  }

  async revokeToken(presentedToken: string): Promise<void> {
    const tokenHash = sha256(presentedToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async signAccessToken(user: AuthenticatedUser): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      isPlatformAdmin: user.isPlatformAdmin,
      roleId: user.roleId,
      typ: 'access',
    };

    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: this.config.getOrThrow<string>('jwt.accessTtl'),
      issuer: this.config.getOrThrow<string>('jwt.issuer'),
    });
  }

  private async signRefreshToken(userId: string, familyId: string, jti: string): Promise<string> {
    const payload: RefreshTokenPayload = { sub: userId, fid: familyId, jti, typ: 'refresh' };

    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
      expiresIn: this.config.getOrThrow<string>('jwt.refreshTtl'),
      issuer: this.config.getOrThrow<string>('jwt.issuer'),
    });
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
        issuer: this.config.getOrThrow<string>('jwt.issuer'),
      });

      if (payload.typ !== 'refresh') {
        throw new Error('wrong token type');
      }

      return payload;
    } catch {
      throw new UnauthorizedAppException('رمز التحديث غير صالح', ERROR_CODE.TOKEN_INVALID);
    }
  }

  private accessTtlSeconds(): number {
    const ttl = this.config.getOrThrow<string>('jwt.accessTtl');
    return parseDuration(ttl);
  }

  private refreshExpiryDate(): Date {
    const ttl = this.config.getOrThrow<string>('jwt.refreshTtl');
    return new Date(Date.now() + parseDuration(ttl) * 1000);
  }
}

const DURATION_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Converts a JWT-style duration ("15m", "30d") into seconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds;
    }
    throw new Error(`Invalid duration: ${value}`);
  }
  return Number(match[1]) * DURATION_UNITS[match[2]];
}
