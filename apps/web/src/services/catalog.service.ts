import { http, unwrap } from './http';
import { cleanParams } from './users.service';
import type { Paginated } from '@/types/api';
import type {
  Category,
  CategoryTreeNode,
  InventoryMovement,
  InventorySummary,
  LowStockRow,
  MovementType,
  Product,
  ProductVariant,
} from '@/types/users';

export interface ProductsQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  isActive?: boolean;
  lowStock?: boolean;
  outOfStock?: boolean;
  sortBy?: 'createdAt' | 'name' | 'price' | 'stock';
  sortOrder?: 'asc' | 'desc';
}

export interface ProductPayload {
  name: string;
  sku?: string;
  description?: string;
  price: number;
  salePrice?: number;
  costPrice?: number;
  categoryId?: string;
  initialStock?: number;
  lowStockThreshold?: number;
  trackInventory?: boolean;
  isActive?: boolean;
  tags?: string[];
  images?: { url: string; alt?: string; isPrimary?: boolean }[];
}

export const productsService = {
  list: (params: ProductsQuery = {}) =>
    unwrap<Paginated<Product>>(http.get('/products', { params: cleanParams(params) })),

  get: (id: string) => unwrap<Product>(http.get(`/products/${id}`)),

  create: (payload: ProductPayload) => unwrap<Product>(http.post('/products', payload)),

  update: (id: string, payload: Partial<ProductPayload>) =>
    unwrap<Product>(http.patch(`/products/${id}`, payload)),

  remove: (id: string) => unwrap<null>(http.delete(`/products/${id}`)),

  listVariants: (productId: string) =>
    unwrap<ProductVariant[]>(http.get(`/products/${productId}/variants`)),

  createVariant: (
    productId: string,
    payload: {
      attributes: Record<string, string>;
      name?: string;
      sku?: string;
      price?: number;
      costPrice?: number;
      initialStock?: number;
    },
  ) => unwrap<ProductVariant>(http.post(`/products/${productId}/variants`, payload)),

  updateVariant: (
    productId: string,
    variantId: string,
    payload: Record<string, unknown>,
  ) => unwrap<ProductVariant>(http.patch(`/products/${productId}/variants/${variantId}`, payload)),

  removeVariant: (productId: string, variantId: string) =>
    unwrap<null>(http.delete(`/products/${productId}/variants/${variantId}`)),
};

export interface CategoryPayload {
  name: string;
  parentId?: string | null;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export const categoriesService = {
  list: (params: { tree?: boolean; search?: string; isActive?: boolean } = {}) =>
    unwrap<Category[]>(http.get('/categories', { params: cleanParams(params) })),

  tree: () => unwrap<CategoryTreeNode[]>(http.get('/categories', { params: { tree: true } })),

  create: (payload: CategoryPayload) => unwrap<Category>(http.post('/categories', payload)),

  update: (id: string, payload: Partial<CategoryPayload>) =>
    unwrap<Category>(http.patch(`/categories/${id}`, payload)),

  remove: (id: string) => unwrap<null>(http.delete(`/categories/${id}`)),
};

export interface MovementsQuery {
  page?: number;
  limit?: number;
  productId?: string;
  variantId?: string;
  type?: MovementType;
  sortOrder?: 'asc' | 'desc';
}

export const inventoryService = {
  movements: (params: MovementsQuery = {}) =>
    unwrap<Paginated<InventoryMovement>>(
      http.get('/inventory/movements', { params: cleanParams(params) }),
    ),

  adjust: (payload: {
    productId: string;
    variantId?: string;
    type: 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT' | 'RETURN';
    quantity: number;
    reason?: string;
  }) =>
    unwrap<{ stockBefore: number; stockAfter: number }>(http.post('/inventory/adjust', payload)),

  lowStock: () => unwrap<LowStockRow[]>(http.get('/inventory/low-stock')),

  summary: () => unwrap<InventorySummary>(http.get('/inventory/summary')),
};
