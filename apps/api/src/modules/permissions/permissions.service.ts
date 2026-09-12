import { Injectable } from '@nestjs/common';
import { PERMISSION_GROUPS, permissionGroupOf } from '@common/constants/permissions.constant';
import { PrismaService } from '@common/prisma/prisma.service';

export interface PermissionGroupView {
  group: string;
  groupLabel: string;
  permissions: { key: string; description: string }[];
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The permission catalog, grouped for the roles matrix in the dashboard. */
  async findAllGrouped(): Promise<PermissionGroupView[]> {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
      select: { key: true, group: true, description: true },
    });

    const byGroup = new Map<string, PermissionGroupView>();

    for (const permission of permissions) {
      const group = permission.group || permissionGroupOf(permission.key);
      if (!byGroup.has(group)) {
        byGroup.set(group, {
          group,
          groupLabel: PERMISSION_GROUPS[group] ?? group,
          permissions: [],
        });
      }
      byGroup.get(group)?.permissions.push({
        key: permission.key,
        description: permission.description,
      });
    }

    return [...byGroup.values()];
  }
}
