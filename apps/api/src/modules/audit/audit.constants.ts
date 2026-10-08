export const AUDIT_ACTION = {
  LOGIN: 'auth.login',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESH: 'auth.token_refresh',
  TOKEN_REUSE_DETECTED: 'auth.token_reuse_detected',
  PASSWORD_CHANGED: 'auth.password_changed',
  REGISTER: 'auth.register',

  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  STATUS_CHANGE: 'status_change',
  PERMISSIONS_CHANGED: 'permissions_changed',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export const AUDIT_ENTITY = {
  AUTH: 'Auth',
  COMPANY: 'Company',
  USER: 'User',
  ROLE: 'Role',
  PRODUCT: 'Product',
  CATEGORY: 'Category',
  INVENTORY: 'Inventory',
  CUSTOMER: 'Customer',
  CONVERSATION: 'Conversation',
  ORDER: 'Order',
  CHANNEL: 'Channel',
  AI_CONFIG: 'AiConfig',
  SETTINGS: 'Settings',
} as const;

export type AuditEntity = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY];
