/**
 * Which Prisma models are tenant-owned, and through which column.
 *
 * Anything listed here is automatically filtered by the current company on every
 * query issued through the tenant-scoped client. Models that are intentionally
 * global (permissions, plans) or scoped through their parent row (product images,
 * refresh tokens) are deliberately absent — see TENANT_EXEMPT_MODELS below.
 */
export const TENANT_SCOPED_MODELS: Record<string, string> = {
  Company: 'id',
  User: 'companyId',
  Role: 'companyId',
  Category: 'companyId',
  Product: 'companyId',
  ProductVariant: 'companyId',
  InventoryMovement: 'companyId',
  Customer: 'companyId',
  CustomerIdentity: 'companyId',
  ChannelConnection: 'companyId',
  Conversation: 'companyId',
  Message: 'companyId',
  AiConfig: 'companyId',
  AiInteraction: 'companyId',
  Order: 'companyId',
  OrderItem: 'companyId',
  OrderStatusHistory: 'companyId',
  Subscription: 'companyId',
  Invoice: 'companyId',
  UsageRecord: 'companyId',
  Notification: 'companyId',
  AuditLog: 'companyId',
};

/**
 * Models that are global by design. Listed explicitly so that adding a new model to
 * schema.prisma without classifying it fails the tenancy guard test in
 * `tenant-scope.spec.ts` instead of silently leaking across companies.
 */
export const TENANT_EXEMPT_MODELS = [
  'Permission',
  'RolePermission',
  'Plan',
  'RefreshToken',
  'ProductImage',
  'WebhookEvent',
] as const;

/** Operations whose `where` clause must be narrowed to the current tenant. */
export const WHERE_SCOPED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/** Operations whose payload must carry the current tenant. */
export const DATA_SCOPED_OPERATIONS = new Set(['create', 'createMany', 'upsert']);

export function isTenantScopedModel(model: string | undefined): model is string {
  return !!model && model in TENANT_SCOPED_MODELS;
}

export function tenantFieldFor(model: string): string {
  return TENANT_SCOPED_MODELS[model];
}
