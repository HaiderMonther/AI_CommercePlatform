import { Injectable, Logger } from '@nestjs/common';
import { CompanyStatus, UserStatus } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { SYSTEM_ROLE } from '@common/constants/roles.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import {
  ConflictAppException,
  UnauthorizedAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuthenticatedUser } from '@common/types/authenticated-user.type';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { CompanyProvisioningService } from '@modules/companies/company-provisioning.service';
import { AuthCompanyDto, LoginResponseDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { PasswordService } from './password.service';
import { PrincipalService } from './principal.service';
import { SessionMetadata, TokenService } from './token.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalService,
    private readonly provisioning: CompanyProvisioningService,
    private readonly audit: AuditService,
    private readonly context: TenantContextService,
  ) {}

  /** Self-service tenant signup: creates the company, its roles and its owner atomically. */
  async register(dto: RegisterCompanyDto, metadata: SessionMetadata): Promise<LoginResponseDto> {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictAppException(
        'البريد الإلكتروني مستخدم مسبقاً',
        ERROR_CODE.EMAIL_ALREADY_USED,
      );
    }

    const slug = await this.provisioning.generateUniqueSlug(dto.companyName);
    const passwordHash = await this.passwords.hash(dto.password);

    const userId = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: dto.companyName,
          slug,
          phone: dto.phone ?? null,
          email: dto.email,
          status: CompanyStatus.TRIAL,
        },
      });

      const roleIds = await this.provisioning.createSystemRoles(tx, company.id);
      await this.provisioning.createDefaultAiConfig(tx, company.id, dto.companyName);
      const trialEndsAt = await this.provisioning.createTrialSubscription(tx, company.id);

      if (trialEndsAt) {
        await tx.company.update({ where: { id: company.id }, data: { trialEndsAt } });
      }

      const owner = await tx.user.create({
        data: {
          companyId: company.id,
          email: dto.email,
          phone: dto.phone ?? null,
          passwordHash,
          fullName: dto.fullName,
          status: UserStatus.ACTIVE,
          roleId: roleIds.get(SYSTEM_ROLE.COMPANY_OWNER) ?? null,
        },
      });

      return owner.id;
    });

    const principal = await this.principals.resolve(userId);

    await this.audit.record({
      action: AUDIT_ACTION.REGISTER,
      entity: AUDIT_ENTITY.COMPANY,
      entityId: principal.companyId,
      newValue: { companyName: dto.companyName, slug, ownerEmail: dto.email },
      companyId: principal.companyId,
      userId: principal.id,
    });

    this.logger.log(`New company registered: ${slug} (${principal.companyId})`);

    return this.buildSession(principal, metadata);
  }

  async login(dto: LoginDto, metadata: SessionMetadata): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true, passwordHash: true, status: true },
    });

    // A constant-ish response shape: the same error is returned for an unknown email and
    // a wrong password so the endpoint cannot be used to enumerate accounts.
    if (!user) {
      await this.passwords.verify(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
        dto.password,
      );
      throw new UnauthorizedAppException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
        ERROR_CODE.INVALID_CREDENTIALS,
      );
    }

    const passwordValid = await this.passwords.verify(user.passwordHash, dto.password);

    if (!passwordValid) {
      await this.audit.record({
        action: AUDIT_ACTION.LOGIN_FAILED,
        entity: AUDIT_ENTITY.AUTH,
        entityId: user.id,
        newValue: { email: dto.email },
        userId: user.id,
      });
      throw new UnauthorizedAppException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
        ERROR_CODE.INVALID_CREDENTIALS,
      );
    }

    const principal = await this.principals.resolve(user.id);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      action: AUDIT_ACTION.LOGIN,
      entity: AUDIT_ENTITY.AUTH,
      entityId: principal.id,
      companyId: principal.companyId,
      userId: principal.id,
    });

    return this.buildSession(principal, metadata);
  }

  async refresh(refreshToken: string, metadata: SessionMetadata): Promise<LoginResponseDto> {
    const { userId, familyId } = await this.tokens.rotate(refreshToken);
    const principal = await this.principals.resolve(userId);
    return this.buildSession(principal, metadata, familyId);
  }

  async logout(refreshToken: string | undefined, user: AuthenticatedUser): Promise<void> {
    if (refreshToken) {
      await this.tokens.revokeToken(refreshToken);
    }

    await this.audit.record({
      action: AUDIT_ACTION.LOGOUT,
      entity: AUDIT_ENTITY.AUTH,
      entityId: user.id,
      companyId: user.companyId,
      userId: user.id,
    });
  }

  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto): Promise<void> {
    const record = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null },
      select: { passwordHash: true },
    });

    if (!record || !(await this.passwords.verify(record.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedAppException(
        'كلمة المرور الحالية غير صحيحة',
        ERROR_CODE.INVALID_CREDENTIALS,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(dto.newPassword) },
    });

    // Changing a password invalidates every other device session.
    await this.tokens.revokeAllForUser(user.id);

    await this.audit.record({
      action: AUDIT_ACTION.PASSWORD_CHANGED,
      entity: AUDIT_ENTITY.USER,
      entityId: user.id,
      companyId: user.companyId,
      userId: user.id,
    });
  }

  async getProfile(user: AuthenticatedUser): Promise<Omit<LoginResponseDto, 'tokens'>> {
    const [record, company] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { avatarUrl: true, role: { select: { key: true, nameAr: true } } },
      }),
      this.loadCompany(user.companyId),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: record.avatarUrl,
        companyId: user.companyId,
        isPlatformAdmin: user.isPlatformAdmin,
        roleKey: record.role?.key ?? null,
        roleName: record.role?.nameAr ?? null,
        permissions: user.permissions,
      },
      company,
    };
  }

  private async buildSession(
    principal: AuthenticatedUser,
    metadata: SessionMetadata,
    familyId?: string,
  ): Promise<LoginResponseDto> {
    const [tokens, profileRecord, company] = await Promise.all([
      this.tokens.issuePair(principal, metadata, familyId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: principal.id },
        select: { avatarUrl: true, role: { select: { key: true, nameAr: true } } },
      }),
      this.loadCompany(principal.companyId),
    ]);

    return {
      user: {
        id: principal.id,
        email: principal.email,
        fullName: principal.fullName,
        avatarUrl: profileRecord.avatarUrl,
        companyId: principal.companyId,
        isPlatformAdmin: principal.isPlatformAdmin,
        roleKey: profileRecord.role?.key ?? null,
        roleName: profileRecord.role?.nameAr ?? null,
        permissions: principal.permissions,
      },
      company,
      tokens,
    };
  }

  private async loadCompany(companyId: string | null): Promise<AuthCompanyDto | null> {
    if (!companyId) {
      return null;
    }

    // Reads the tenant row through the raw client: at login time the request context is
    // not yet populated, and the id being loaded is the one the principal belongs to.
    const company = await this.context.runUnscoped(() =>
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          status: true,
          planTier: true,
          logoUrl: true,
        },
      }),
    );

    return company;
  }
}
