import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { UnauthorizedAppException } from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuthenticatedUser } from '@common/types/authenticated-user.type';

/**
 * Resolves the full authenticated principal (identity + effective permissions).
 *
 * Permissions are read from the database on every authenticated request rather than
 * embedded in the JWT, so revoking a role takes effect immediately instead of waiting
 * for the access token to expire.
 */
@Injectable()
export class PrincipalService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        company: { select: { id: true, status: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedAppException('الحساب غير موجود', ERROR_CODE.UNAUTHENTICATED);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedAppException('الحساب موقوف', ERROR_CODE.ACCOUNT_SUSPENDED);
    }

    if (user.company && ['SUSPENDED', 'CANCELLED'].includes(user.company.status)) {
      throw new UnauthorizedAppException('اشتراك الشركة موقوف', ERROR_CODE.COMPANY_SUSPENDED);
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      companyId: user.companyId,
      isPlatformAdmin: user.isPlatformAdmin,
      roleId: user.roleId,
      roleKey: user.role?.key ?? null,
      permissions: user.role?.permissions.map((link) => link.permission.key) ?? [],
    };
  }
}
