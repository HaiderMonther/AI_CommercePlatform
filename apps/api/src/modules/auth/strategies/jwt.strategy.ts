import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { UnauthorizedAppException } from '@common/exceptions/app.exception';
import { AccessTokenPayload, AuthenticatedUser } from '@common/types/authenticated-user.type';
import { PrincipalService } from '../principal.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly principals: PrincipalService,
    private readonly tenantContext: TenantContextService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
      issuer: config.getOrThrow<string>('jwt.issuer'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.typ !== 'access') {
      throw new UnauthorizedAppException('رمز الدخول غير صالح', ERROR_CODE.TOKEN_INVALID);
    }

    const principal = await this.principals.resolve(payload.sub);

    // The tenant comes from the freshly resolved user record, never from the token body,
    // so a tampered or stale `companyId` claim cannot widen access.
    this.tenantContext.setAuthContext({
      userId: principal.id,
      companyId: principal.companyId,
      isPlatformAdmin: principal.isPlatformAdmin,
      permissions: principal.permissions,
    });

    return principal;
  }
}
