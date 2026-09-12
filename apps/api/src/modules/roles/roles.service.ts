import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { slugify } from '@common/utils/slug.util';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { TokenService } from '@modules/auth/token.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  nameAr: true,
  description: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { users: true } },
} as const;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

export interface RoleView {
  id: string;
  key: string;
  name: string;
  nameAr: string;
  description: string | null;
  isSystem: boolean;
  usersCount: number;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class RolesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly context: TenantContextService,
  ) {}

  async findAll(): Promise<RoleView[]> {
    const roles = await this.db.role.findMany({
      select: ROLE_SELECT,
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    });

    return roles.map((role) => this.toView(role));
  }

  async findOne(id: string): Promise<RoleView> {
    const role = await this.db.role.findFirst({ where: { id }, select: ROLE_SELECT });

    if (!role) {
      throw new NotFoundAppException('الدور غير موجود', ERROR_CODE.ROLE_NOT_FOUND);
    }

    return this.toView(role);
  }

  async create(dto: CreateRoleDto): Promise<RoleView> {
    const key = await this.generateKey(dto.name);
    const permissionIds = await this.resolvePermissionIds(dto.permissions);

    const role = await this.db.role.create({
      data: {
        key,
        name: dto.name,
        nameAr: dto.nameAr,
        description: dto.description ?? null,
        isSystem: false,
        permissions: { createMany: { data: permissionIds.map((permissionId) => ({ permissionId })) } },
      },
      select: ROLE_SELECT,
    });

    await this.audit.record({
      action: AUDIT_ACTION.CREATE,
      entity: AUDIT_ENTITY.ROLE,
      entityId: role.id,
      newValue: this.toView(role),
    });

    return this.toView(role);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleView> {
    const before = await this.findOne(id);
    this.assertEditable(before);

    const permissionIds = dto.permissions
      ? await this.resolvePermissionIds(dto.permissions)
      : undefined;

    const role = await this.db.role.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(permissionIds
          ? {
              permissions: {
                deleteMany: {},
                createMany: { data: permissionIds.map((permissionId) => ({ permissionId })) },
              },
            }
          : {}),
      },
      select: ROLE_SELECT,
    });

    // Permission changes must reach live sessions immediately.
    if (permissionIds) {
      await this.revokeSessionsForRole(id);
    }

    await this.audit.record({
      action: permissionIds ? AUDIT_ACTION.PERMISSIONS_CHANGED : AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.ROLE,
      entityId: id,
      oldValue: before,
      newValue: this.toView(role),
    });

    return this.toView(role);
  }

  async remove(id: string): Promise<void> {
    const role = await this.findOne(id);
    this.assertEditable(role);

    if (role.usersCount > 0) {
      throw new ConflictAppException(
        'لا يمكن حذف دور مرتبط بمستخدمين، قم بنقلهم إلى دور آخر أولاً',
        ERROR_CODE.ROLE_IN_USE,
      );
    }

    await this.db.role.delete({ where: { id } });

    await this.audit.record({
      action: AUDIT_ACTION.DELETE,
      entity: AUDIT_ENTITY.ROLE,
      entityId: id,
      oldValue: role,
    });
  }

  private assertEditable(role: RoleView): void {
    if (role.isSystem) {
      throw new BadRequestAppException(
        'لا يمكن تعديل الأدوار الافتراضية، أنشئ دوراً مخصصاً بدلاً من ذلك',
        ERROR_CODE.SYSTEM_ROLE_IMMUTABLE,
      );
    }
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    const permissions = await this.db.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });

    if (permissions.length !== keys.length) {
      throw new BadRequestAppException('إحدى الصلاحيات المرسلة غير معروفة');
    }

    return permissions.map((permission) => permission.id);
  }

  private async generateKey(name: string): Promise<string> {
    const base = (slugify(name).replace(/-/g, '_').toUpperCase() || 'CUSTOM_ROLE').slice(0, 40);
    const companyId = this.context.getCompanyId();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}_${attempt + 1}`;
      const existing = await this.db.role.findFirst({
        where: { key: candidate, companyId },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }

    return `${base}_${Date.now().toString(36).toUpperCase()}`;
  }

  private async revokeSessionsForRole(roleId: string): Promise<void> {
    const users = await this.db.user.findMany({
      where: { roleId, deletedAt: null },
      select: { id: true },
    });

    await Promise.all(users.map((user) => this.tokens.revokeAllForUser(user.id)));
  }

  private toView(role: RoleRow): RoleView {
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      nameAr: role.nameAr,
      description: role.description,
      isSystem: role.isSystem,
      usersCount: role._count.users,
      permissions: role.permissions.map((link) => link.permission.key),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
