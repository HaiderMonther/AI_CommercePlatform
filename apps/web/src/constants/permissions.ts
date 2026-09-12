/**
 * Mirror of the API permission catalog. Kept as a const object so route guards and
 * `v-if` checks are typo-proof; the API remains the enforcement point.
 */
export const PERMISSIONS = {
  COMPANY_READ: 'company.read',
  COMPANY_UPDATE: 'company.update',
  USERS_READ: 'users.read',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',
  ROLES_READ: 'roles.read',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',
  ROLES_DELETE: 'roles.delete',
  PRODUCTS_READ: 'products.read',
  CATEGORIES_READ: 'categories.read',
  INVENTORY_READ: 'inventory.read',
  CUSTOMERS_READ: 'customers.read',
  CONVERSATIONS_READ: 'conversations.read',
  ORDERS_READ: 'orders.read',
  CHANNELS_READ: 'channels.read',
  AI_SETTINGS_READ: 'ai.settings.read',
  REPORTS_READ: 'reports.read',
  BILLING_READ: 'billing.read',
  AUDIT_READ: 'audit.read',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
