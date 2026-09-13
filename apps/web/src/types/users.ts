export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  nameAr: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  roleId: string | null;
  role: RoleSummary | null;
}

export interface CreateUserPayload {
  email: string;
  fullName: string;
  password: string;
  roleId: string;
  phone?: string;
  status?: UserStatus;
}

export interface UpdateUserPayload {
  fullName?: string;
  phone?: string;
  roleId?: string;
  status?: UserStatus;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  nameAr: string;
  description: string | null;
  isSystem: boolean;
  usersCount: number;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PermissionGroup {
  group: string;
  groupLabel: string;
  permissions: { key: string; description: string }[];
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  status: string;
  planTier: string;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyStats {
  companyId: string;
  users: number;
  products: number;
  customers: number;
  orders: number;
  channels: number;
}

export interface AuditLog {
  id: string;
  companyId: string | null;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
  correlationId: string | null;
  createdAt: string;
  user: { id: string; fullName: string; email: string } | null;
}

// --- Catalog (Phase 2) -------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  productsCount: number;
  childrenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

export interface ProductImage {
  id: string;
  url: string;
  alt: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  name: string;
  attributes: Record<string, string>;
  price: number | null;
  salePrice: number | null;
  costPrice: number | null;
  stock: number;
  reservedStock: number;
  availableStock: number;
  imageUrl: string | null;
  isActive: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  price: number;
  salePrice: number | null;
  costPrice: number | null;
  currency: string;
  stock: number;
  reservedStock: number;
  availableStock: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  hasVariants: boolean;
  isLowStock: boolean;
  variantsCount: number;
  tags: string[];
  isActive: boolean;
  categoryId: string | null;
  category: { id: string; name: string; slug: string } | null;
  images: ProductImage[];
  variants?: ProductVariant[];
  createdAt: string;
  updatedAt: string;
}

export type MovementType =
  | 'STOCK_IN'
  | 'STOCK_OUT'
  | 'ADJUSTMENT'
  | 'SALE'
  | 'RETURN'
  | 'RESERVATION'
  | 'RELEASE';

export interface InventoryMovement {
  id: string;
  productId: string;
  variantId: string | null;
  type: MovementType;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  referenceType: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string } | null;
  variant: { id: string; name: string; sku: string } | null;
  user: { id: string; fullName: string } | null;
}

export interface InventorySummary {
  totalProducts: number;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  stockValue: string;
}

export interface LowStockRow {
  id: string;
  name: string;
  sku: string;
  stock: number;
  reservedStock: number;
  lowStockThreshold: number;
}
