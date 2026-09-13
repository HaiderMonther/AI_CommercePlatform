<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import ConfirmDialog from '@/components/data/ConfirmDialog.vue';
import EmptyState from '@/components/data/EmptyState.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import ProductFormDialog from './components/ProductFormDialog.vue';
import VariantsDialog from './components/VariantsDialog.vue';
import StockAdjustDialog from './components/StockAdjustDialog.vue';
import { PERMISSIONS } from '@/constants/permissions';
import { categoriesService, productsService } from '@/services/catalog.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import { formatCurrency, formatNumber } from '@/utils/format';
import type { Category, Product } from '@/types/users';

const auth = useAuthStore();
const ui = useUiStore();

const products = ref<Product[]>([]);
const categories = ref<Category[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(10);
const search = ref('');
const categoryFilter = ref<string | null>(null);
const stockFilter = ref<string | null>(null);
const activeFilter = ref<boolean | null>(null);

const loading = ref(false);
const loadError = ref<ApiError | null>(null);

const formOpen = ref(false);
const editing = ref<Product | null>(null);
const variantsTarget = ref<Product | null>(null);
const adjustTarget = ref<Product | null>(null);
const deleteTarget = ref<Product | null>(null);
const deleting = ref(false);

const canCreate = computed(() => auth.can(PERMISSIONS.PRODUCTS_CREATE));
const canUpdate = computed(() => auth.can(PERMISSIONS.PRODUCTS_UPDATE));
const canDelete = computed(() => auth.can(PERMISSIONS.PRODUCTS_DELETE));
const canAdjust = computed(() => auth.can(PERMISSIONS.INVENTORY_ADJUST));

const headers = [
  { title: 'المنتج', key: 'name', sortable: false },
  { title: 'التصنيف', key: 'category', sortable: false, width: 150 },
  { title: 'السعر', key: 'price', sortable: false, width: 140 },
  { title: 'المخزون', key: 'stock', sortable: false, width: 150 },
  { title: 'الحالة', key: 'isActive', sortable: false, width: 100 },
  { title: '', key: 'actions', sortable: false, align: 'end' as const, width: 60 },
];

const categoryOptions = computed(() =>
  categories.value.map((category) => ({
    value: category.id,
    title: category.parentId ? `— ${category.name}` : category.name,
  })),
);

const stockOptions = [
  { value: 'low', title: 'مخزون منخفض' },
  { value: 'out', title: 'نفد المخزون' },
];

const activeOptions = [
  { value: true, title: 'مفعّل' },
  { value: false, title: 'غير مفعّل' },
];

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;

  try {
    const result = await productsService.list({
      page: page.value,
      limit: limit.value,
      search: search.value || undefined,
      categoryId: categoryFilter.value ?? undefined,
      isActive: activeFilter.value ?? undefined,
      lowStock: stockFilter.value === 'low' ? true : undefined,
      outOfStock: stockFilter.value === 'out' ? true : undefined,
    });
    products.value = result.items;
    total.value = result.meta.total;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

async function loadCategories(): Promise<void> {
  if (!auth.can(PERMISSIONS.CATEGORIES_READ)) return;
  try {
    categories.value = await categoriesService.list();
  } catch {
    // The filter is a convenience; the table must still render without it.
  }
}

let searchTimer: number | undefined;

watch(search, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    load();
  }, 350);
});

watch([page, limit, categoryFilter, stockFilter, activeFilter], load);

onMounted(() => {
  load();
  loadCategories();
});

function openCreate(): void {
  editing.value = null;
  formOpen.value = true;
}

function openEdit(product: Product): void {
  editing.value = product;
  formOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;

  deleting.value = true;
  try {
    await productsService.remove(deleteTarget.value.id);
    ui.success('تم حذف المنتج');
    deleteTarget.value = null;
    await load();
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر حذف المنتج');
  } finally {
    deleting.value = false;
  }
}

function primaryImage(product: Product): string | null {
  return product.images?.find((image) => image.isPrimary)?.url ?? product.images?.[0]?.url ?? null;
}

function stockColor(product: Product): string {
  if (!product.trackInventory) return 'default';
  if (product.stock <= 0) return 'error';
  return product.isLowStock ? 'warning' : 'success';
}
</script>

<template>
  <div>
    <PageHeader title="المنتجات" subtitle="كتالوج المتجر الذي يبحث فيه المساعد الذكي">
      <template #actions>
        <v-btn v-if="canCreate" color="primary" prepend-icon="mdi-plus" @click="openCreate">
          إضافة منتج
        </v-btn>
      </template>
    </PageHeader>

    <v-card>
      <div class="d-flex flex-wrap ga-3 pa-4">
        <v-text-field
          v-model="search"
          placeholder="ابحث بالاسم أو الرمز أو الوصف"
          prepend-inner-icon="mdi-magnify"
          clearable
          style="min-width: 240px; max-width: 340px"
        />
        <v-select
          v-if="categoryOptions.length"
          v-model="categoryFilter"
          :items="categoryOptions"
          label="التصنيف"
          clearable
          style="max-width: 200px"
        />
        <v-select
          v-model="stockFilter"
          :items="stockOptions"
          label="المخزون"
          clearable
          style="max-width: 180px"
        />
        <v-select
          v-model="activeFilter"
          :items="activeOptions"
          label="الحالة"
          clearable
          style="max-width: 150px"
        />
      </div>

      <v-divider />

      <ErrorState
        v-if="loadError"
        :message="loadError.message"
        :correlation-id="loadError.correlationId"
        @retry="load"
      />

      <v-data-table-server
        v-else
        v-model:page="page"
        v-model:items-per-page="limit"
        :headers="headers"
        :items="products"
        :items-length="total"
        :loading="loading"
        :items-per-page-options="[10, 25, 50]"
        item-value="id"
      >
        <template #item.name="{ item }">
          <div class="d-flex align-center ga-3 py-2">
            <v-avatar rounded="lg" size="44" color="surface-variant">
              <v-img v-if="primaryImage(item)" :src="primaryImage(item)!" cover />
              <v-icon v-else icon="mdi-package-variant-closed" />
            </v-avatar>
            <div class="min-w-0">
              <div class="text-body-2 font-weight-medium text-truncate">{{ item.name }}</div>
              <div class="text-caption text-medium-emphasis numeric">{{ item.sku }}</div>
            </div>
          </div>
        </template>

        <template #item.category="{ item }">
          <v-chip v-if="item.category" size="small" variant="tonal">{{ item.category.name }}</v-chip>
          <span v-else class="text-medium-emphasis">—</span>
        </template>

        <template #item.price="{ item }">
          <div>
            <div v-if="item.salePrice" class="d-flex flex-column">
              <span class="text-body-2 font-weight-medium">
                {{ formatCurrency(item.salePrice, item.currency) }}
              </span>
              <span class="text-caption text-decoration-line-through text-medium-emphasis">
                {{ formatCurrency(item.price, item.currency) }}
              </span>
            </div>
            <span v-else class="text-body-2">{{ formatCurrency(item.price, item.currency) }}</span>
          </div>
        </template>

        <template #item.stock="{ item }">
          <div v-if="!item.trackInventory" class="text-caption text-medium-emphasis">
            غير متتبَّع
          </div>
          <div v-else class="d-flex align-center ga-2">
            <v-chip :color="stockColor(item)" size="small" variant="tonal">
              <span class="numeric">{{ formatNumber(item.stock) }}</span>
            </v-chip>
            <!-- Variant products carry their stock on the variants, not the parent row. -->
            <v-chip
              v-if="item.hasVariants"
              size="x-small"
              variant="outlined"
              class="cursor-pointer"
              @click="variantsTarget = item"
            >
              <span class="numeric">{{ item.variantsCount }}</span>&nbsp;متغير
            </v-chip>
          </div>
        </template>

        <template #item.isActive="{ item }">
          <v-chip :color="item.isActive ? 'success' : 'default'" size="small" variant="tonal">
            {{ item.isActive ? 'مفعّل' : 'متوقف' }}
          </v-chip>
        </template>

        <template #item.actions="{ item }">
          <v-menu location="bottom end">
            <template #activator="{ props }">
              <v-btn v-bind="props" icon="mdi-dots-vertical" variant="text" size="small" />
            </template>
            <v-list density="compact">
              <v-list-item
                v-if="canUpdate"
                prepend-icon="mdi-pencil-outline"
                title="تعديل"
                @click="openEdit(item)"
              />
              <v-list-item
                v-if="canUpdate"
                prepend-icon="mdi-palette-swatch-outline"
                title="المتغيرات"
                @click="variantsTarget = item"
              />
              <v-list-item
                v-if="canAdjust && item.trackInventory && !item.hasVariants"
                prepend-icon="mdi-warehouse"
                title="تعديل المخزون"
                @click="adjustTarget = item"
              />
              <v-list-item
                v-if="canDelete"
                prepend-icon="mdi-delete-outline"
                title="حذف"
                base-color="error"
                @click="deleteTarget = item"
              />
            </v-list>
          </v-menu>
        </template>

        <template #no-data>
          <EmptyState
            icon="mdi-package-variant-closed"
            title="لا توجد منتجات"
            description="أضف منتجاتك ليتمكن المساعد الذكي من البحث فيها والرد على الزبائن."
            :action-label="canCreate ? 'إضافة منتج' : undefined"
            @action="openCreate"
          />
        </template>
      </v-data-table-server>
    </v-card>

    <ProductFormDialog
      v-model="formOpen"
      :product="editing"
      :categories="categories"
      @saved="load"
    />

    <VariantsDialog
      :model-value="Boolean(variantsTarget)"
      :product="variantsTarget"
      @update:model-value="variantsTarget = null"
      @changed="load"
    />

    <StockAdjustDialog
      :model-value="Boolean(adjustTarget)"
      :product="adjustTarget"
      @update:model-value="adjustTarget = null"
      @saved="load"
    />

    <ConfirmDialog
      :model-value="Boolean(deleteTarget)"
      title="حذف المنتج"
      :message="`سيتم حذف «${deleteTarget?.name ?? ''}» ويبقى ضمن سجل الطلبات السابقة.`"
      confirm-label="حذف"
      :loading="deleting"
      @update:model-value="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.min-w-0 {
  min-width: 0;
}
</style>
