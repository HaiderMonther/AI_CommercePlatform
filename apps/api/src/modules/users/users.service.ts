import { Inject, Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { SYSTEM_ROLE } from '@common/constants/roles.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { PaginatedResult, paginate } from '@common/dto/pagination.dto';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { PasswordService } from '@modules/auth/password.service';
import { TokenService } from '@modules/auth/token.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { ResetUserPasswordDto, UpdateUserDto } from './dto/update-user.dto';

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  avatarUrl: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roleId: true,
  role: { select: { id: true, key: true, name: true, nameAr: true } },
} as const;

export type UserView = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable()
export class UsersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly context: TenantContextService,
  ) {}

  async findAll(query: QueryUsersDto): Promise<PaginatedResult<UserView>> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.roleId ? { roleId: query.roleId } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: query.sortOrder },
        skip: query.skip,
        take: query.limit,
      }),
      this.db.user.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<UserView> {
    const user = await this.db.user.findFirst({
      where: { id, deletedAt: null },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundAppException('المستخدم غير موجود');
    }

    return user;
  }

  async create(dto: CreateUserDto): Promise<UserView> {
    await this.assertRoleBelongsToTenant(dto.roleId);
    await this.assertEmailAvailable(dto.email);

    const user = await this.db.user.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        phone: dto.phone ?? null,
        roleId: dto.roleId,
        status: dto.status ?? UserStatus.ACTIVE,
        passwordHash: await this.passwords.hash(dto.password),
      },
      select: USER_SELECT,
    });

    await this.audit.record({
      action: AUDIT_ACTION.CREATE,
      entity: AUDIT_ENTITY.USER,
      entityId: user.id,
      newValue: user,
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserView> {
    const before = await this.findOne(id);

    if (dto.roleId && dto.roleId !== before.roleId) {
      await this.assertRoleBelongsToTenant(dto.roleId);
      await this.assertNotLastOwner(before, 'role');
    }

    if (dto.status && dto.status !== before.status && dto.status !== UserStatus.ACTIVE) {
      await this.assertNotLastOwner(before, 'status');
      await this.assertNotSelf(id, 'لا يمكنك إيقاف حسابك الخاص');
    }

    const user = await this.db.user.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      select: USER_SELECT,
    });

    // A revoked role or a suspended account must not survive on an existing session.
    if (dto.roleId !== undefined || dto.status !== undefined) {
      await this.tokens.revokeAllForUser(id);
    }

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.USER,
      entityId: id,
      oldValue: before,
      newValue: user,
    });

    return user;
  }

  async resetPassword(id: string, dto: ResetUserPasswordDto): Promise<void> {
    const user = await this.findOne(id);

    await this.db.user.update({
      where: { id },
      data: { passwordHash: await this.passwords.hash(dto.newPassword) },
    });

    await this.tokens.revokeAllForUser(id);

    await this.audit.record({
      action: AUDIT_ACTION.PASSWORD_CHANGED,
      entity: AUDIT_ENTITY.USER,
      entityId: user.id,
      newValue: { resetBy: this.context.getUserId() },
    });
  }

  /**
   * Soft delete. The email is released by suffixing the stored value so the same person
   * can be re-invited later, while the row is kept for audit and order history.
   */
  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);

    await this.assertNotSelf(id, 'لا يمكنك حذف حسابك الخاص');
    await this.assertNotLastOwner(user, 'delete');

    const deletedAt = new Date();

    await this.db.user.update({
      where: { id },
      data: {
        deletedAt,
        status: UserStatus.SUSPENDED,
        email: `${user.email}.deleted.${deletedAt.getTime()}`,
      },
    });

    await this.tokens.revokeAllForUser(id);

    await this.audit.record({
      action: AUDIT_ACTION.DELETE,
      entity: AUDIT_ENTITY.USER,
      entityId: id,
      oldValue: user,
    });
  }

  private async assertRoleBelongsToTenant(roleId: string): Promise<void> {
    const role = await this.db.role.findFirst({ where: { id: roleId }, select: { id: true } });
    if (!role) {
      throw new BadRequestAppException('الدور غير موجود', ERROR_CODE.ROLE_NOT_FOUND);
    }
  }

  /**
   * Email uniqueness is checked across all tenants because a single address maps to a
   * single login. The lookup deliberately bypasses tenant scoping, but only ever returns
   * a boolean — no foreign-tenant data leaves this method.
   */
  private async assertEmailAvailable(email: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictAppException(
        'البريد الإلكتروني مستخدم مسبقاً',
        ERROR_CODE.EMAIL_ALREADY_USED,
      );
    }
  }

  private async assertNotSelf(id: string, message: string): Promise<void> {
    if (this.context.getUserId() === id) {
      throw new BadRequestAppException(message);
    }
  }

  /** A company must always keep at least one active owner, or it locks itself out. */
  private async assertNotLastOwner(user: UserView, _reason: string): Promise<void> {
    if (user.role?.key !== SYSTEM_ROLE.COMPANY_OWNER) {
      return;
    }

    const activeOwners = await this.db.user.count({
      where: {
        deletedAt: null,
        status: UserStatus.ACTIVE,
        role: { key: SYSTEM_ROLE.COMPANY_OWNER },
      },
    });

    if (activeOwners <= 1) {
      throw new BadRequestAppException(
        'يجب أن يبقى مالك واحد فعال على الأقل للشركة',
        ERROR_CODE.LAST_OWNER_PROTECTED,
      );
    }
  }
}
