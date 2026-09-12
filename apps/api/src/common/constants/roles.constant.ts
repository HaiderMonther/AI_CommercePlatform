import { ALL_PERMISSIONS, PERMISSIONS, PermissionKey } from './permissions.constant';

export const SYSTEM_ROLE = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COMPANY_OWNER: 'COMPANY_OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  SALES_AGENT: 'SALES_AGENT',
  VIEWER: 'VIEWER',
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE)[keyof typeof SYSTEM_ROLE];

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  nameAr: string;
  description: string;
  permissions: PermissionKey[];
}

const P = PERMISSIONS;

const TENANT_PERMISSIONS: PermissionKey[] = ALL_PERMISSIONS.filter(
  (p) => !p.startsWith('platform.'),
);

const READ_ONLY_PERMISSIONS: PermissionKey[] = TENANT_PERMISSIONS.filter((p) =>
  p.endsWith('.read'),
);

/**
 * System roles are created for every new company. They are not editable, but a company
 * owner can clone them into custom roles with a different permission set.
 */
export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: SYSTEM_ROLE.COMPANY_OWNER,
    name: 'Company Owner',
    nameAr: 'مالك الشركة',
    description: 'صلاحيات كاملة على بيانات الشركة',
    permissions: TENANT_PERMISSIONS,
  },
  {
    key: SYSTEM_ROLE.ADMIN,
    name: 'Admin',
    nameAr: 'مدير النظام',
    description: 'إدارة كاملة عدا الاشتراك والفوترة',
    permissions: TENANT_PERMISSIONS.filter((p) => !p.startsWith('billing.')),
  },
  {
    key: SYSTEM_ROLE.MANAGER,
    name: 'Manager',
    nameAr: 'مدير',
    description: 'إدارة المبيعات والمخزون والتقارير',
    permissions: [
      P.COMPANY_READ,
      P.USERS_READ,
      P.PRODUCTS_READ,
      P.PRODUCTS_CREATE,
      P.PRODUCTS_UPDATE,
      P.CATEGORIES_READ,
      P.CATEGORIES_CREATE,
      P.CATEGORIES_UPDATE,
      P.INVENTORY_READ,
      P.INVENTORY_ADJUST,
      P.CUSTOMERS_READ,
      P.CUSTOMERS_CREATE,
      P.CUSTOMERS_UPDATE,
      P.CONVERSATIONS_READ,
      P.CONVERSATIONS_REPLY,
      P.CONVERSATIONS_ASSIGN,
      P.CONVERSATIONS_CLOSE,
      P.ORDERS_READ,
      P.ORDERS_CREATE,
      P.ORDERS_UPDATE,
      P.CHANNELS_READ,
      P.AI_SETTINGS_READ,
      P.REPORTS_READ,
    ],
  },
  {
    key: SYSTEM_ROLE.SALES_AGENT,
    name: 'Sales Agent',
    nameAr: 'مندوب مبيعات',
    description: 'الرد على المحادثات وإنشاء الطلبات',
    permissions: [
      P.COMPANY_READ,
      P.PRODUCTS_READ,
      P.CATEGORIES_READ,
      P.INVENTORY_READ,
      P.CUSTOMERS_READ,
      P.CUSTOMERS_CREATE,
      P.CUSTOMERS_UPDATE,
      P.CONVERSATIONS_READ,
      P.CONVERSATIONS_REPLY,
      P.CONVERSATIONS_CLOSE,
      P.ORDERS_READ,
      P.ORDERS_CREATE,
      P.ORDERS_UPDATE,
    ],
  },
  {
    key: SYSTEM_ROLE.VIEWER,
    name: 'Viewer',
    nameAr: 'مشاهد',
    description: 'عرض فقط دون أي تعديل',
    permissions: READ_ONLY_PERMISSIONS,
  },
];

export const SUPER_ADMIN_ROLE: SystemRoleDefinition = {
  key: SYSTEM_ROLE.SUPER_ADMIN,
  name: 'Super Admin',
  nameAr: 'مدير المنصة',
  description: 'صلاحيات كاملة على مستوى المنصة',
  permissions: ALL_PERMISSIONS,
};
