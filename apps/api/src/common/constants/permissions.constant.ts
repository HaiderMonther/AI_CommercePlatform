/**
 * Central permission catalog. Permissions are plain strings of the form `<group>.<action>`
 * so new capabilities can be added without a schema change. The seed keeps the `permissions`
 * table in sync with this file.
 */
export const PERMISSIONS = {
  // Company
  COMPANY_READ: 'company.read',
  COMPANY_UPDATE: 'company.update',

  // Users
  USERS_READ: 'users.read',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',

  // Roles & permissions
  ROLES_READ: 'roles.read',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',
  ROLES_DELETE: 'roles.delete',

  // Catalog
  PRODUCTS_READ: 'products.read',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_UPDATE: 'products.update',
  PRODUCTS_DELETE: 'products.delete',

  CATEGORIES_READ: 'categories.read',
  CATEGORIES_CREATE: 'categories.create',
  CATEGORIES_UPDATE: 'categories.update',
  CATEGORIES_DELETE: 'categories.delete',

  // Inventory
  INVENTORY_READ: 'inventory.read',
  INVENTORY_ADJUST: 'inventory.adjust',

  // Customers
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_UPDATE: 'customers.update',
  CUSTOMERS_DELETE: 'customers.delete',

  // Conversations
  CONVERSATIONS_READ: 'conversations.read',
  CONVERSATIONS_REPLY: 'conversations.reply',
  CONVERSATIONS_ASSIGN: 'conversations.assign',
  CONVERSATIONS_CLOSE: 'conversations.close',

  // Orders
  ORDERS_READ: 'orders.read',
  ORDERS_CREATE: 'orders.create',
  ORDERS_UPDATE: 'orders.update',
  ORDERS_DELETE: 'orders.delete',

  // Channels
  CHANNELS_READ: 'channels.read',
  CHANNELS_MANAGE: 'channels.manage',

  // AI
  AI_SETTINGS_READ: 'ai.settings.read',
  AI_SETTINGS_UPDATE: 'ai.settings.update',

  // Reports
  REPORTS_READ: 'reports.read',

  // Billing
  BILLING_READ: 'billing.read',
  BILLING_MANAGE: 'billing.manage',

  // Audit
  AUDIT_READ: 'audit.read',

  // Platform (super admin only)
  PLATFORM_COMPANIES_READ: 'platform.companies.read',
  PLATFORM_COMPANIES_MANAGE: 'platform.companies.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

/** Human-readable Arabic descriptions used by the seed and the roles UI. */
export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'company.read': 'عرض بيانات الشركة',
  'company.update': 'تعديل بيانات الشركة',
  'users.read': 'عرض المستخدمين',
  'users.create': 'إضافة مستخدم',
  'users.update': 'تعديل مستخدم',
  'users.delete': 'حذف مستخدم',
  'roles.read': 'عرض الأدوار',
  'roles.create': 'إضافة دور',
  'roles.update': 'تعديل دور',
  'roles.delete': 'حذف دور',
  'products.read': 'عرض المنتجات',
  'products.create': 'إضافة منتج',
  'products.update': 'تعديل منتج',
  'products.delete': 'حذف منتج',
  'categories.read': 'عرض التصنيفات',
  'categories.create': 'إضافة تصنيف',
  'categories.update': 'تعديل تصنيف',
  'categories.delete': 'حذف تصنيف',
  'inventory.read': 'عرض المخزون',
  'inventory.adjust': 'تعديل المخزون',
  'customers.read': 'عرض الزبائن',
  'customers.create': 'إضافة زبون',
  'customers.update': 'تعديل زبون',
  'customers.delete': 'حذف زبون',
  'conversations.read': 'عرض المحادثات',
  'conversations.reply': 'الرد على المحادثات',
  'conversations.assign': 'إسناد المحادثات',
  'conversations.close': 'إغلاق المحادثات',
  'orders.read': 'عرض الطلبات',
  'orders.create': 'إنشاء طلب',
  'orders.update': 'تعديل طلب',
  'orders.delete': 'حذف طلب',
  'channels.read': 'عرض القنوات',
  'channels.manage': 'إدارة القنوات',
  'ai.settings.read': 'عرض إعدادات الذكاء الاصطناعي',
  'ai.settings.update': 'تعديل إعدادات الذكاء الاصطناعي',
  'reports.read': 'عرض التقارير',
  'billing.read': 'عرض الاشتراك والفواتير',
  'billing.manage': 'إدارة الاشتراك',
  'audit.read': 'عرض سجل العمليات',
  'platform.companies.read': 'عرض شركات المنصة',
  'platform.companies.manage': 'إدارة شركات المنصة',
};

/** Groups used to lay out the permissions matrix in the dashboard. */
export const PERMISSION_GROUPS: Record<string, string> = {
  company: 'الشركة',
  users: 'المستخدمون',
  roles: 'الأدوار',
  products: 'المنتجات',
  categories: 'التصنيفات',
  inventory: 'المخزون',
  customers: 'الزبائن',
  conversations: 'المحادثات',
  orders: 'الطلبات',
  channels: 'القنوات',
  ai: 'الذكاء الاصطناعي',
  reports: 'التقارير',
  billing: 'الاشتراك',
  audit: 'سجل العمليات',
  platform: 'المنصة',
};

export function permissionGroupOf(key: string): string {
  return key.split('.')[0];
}
