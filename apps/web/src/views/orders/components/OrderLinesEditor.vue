<script setup lang="ts">
import { ref, watch } from 'vue';
import { productsService } from '@/services/catalog.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type { Product } from '@/types/users';
import { formatCurrency } from '@/utils/format';
import { lineTotal } from '@/utils/orders';
import { type EditorLine, lineFromProduct, selectVariant } from './order-lines';

const lines = defineModel<EditorLine[]>({ required: true });

const auth = useAuthStore();
const ui = useUiStore();

const search = ref('');
const results = ref<Product[]>([]);
const searching = ref(false);
const adding = ref(false);
const picker = ref<Product | null>(null);

let searchTimer: number | undefined;

watch(search, (value) => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => runSearch(value ?? ''), 300);
});

async function runSearch(term: string): Promise<void> {
  searching.value = true;
  try {
    const page = await productsService.list({
      search: term.trim() || undefined,
      isActive: true,
      limit: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    results.value = page.items;
  } catch {
    results.value = [];
  } finally {
    searching.value = false;
  }
}

/** A product with variants is loaded in full so its colours and sizes can be picked. */
async function add(product: Product | null): Promise<void> {
  if (!product) return;

  adding.value = true;
  try {
    const full = product.hasVariants ? await productsService.get(product.id) : product;
    lines.value = [...lines.value, lineFromProduct(full)];
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر إضافة المنتج');
  } finally {
    adding.value = false;
    picker.value = null;
    search.value = '';
  }
}

function update(key: string, patch: Partial<EditorLine>): void {
  lines.value = lines.value.map((line) => (line.key === key ? { ...line, ...patch } : line));
}

function changeVariant(line: EditorLine, variantId: string): void {
  lines.value = lines.value.map((item) => (item.key === line.key ? selectVariant(item, variantId) : item));
}

function remove(key: string): void {
  lines.value = lines.value.filter((line) => line.key !== key);
}

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

runSearch('');
</script>

<template>
  <div>
    <v-autocomplete
      v-model="picker"
      v-model:search="search"
      :items="results"
      :loading="searching || adding"
      item-title="name"
      item-value="id"
      return-object
      no-filter
      clearable
      prepend-inner-icon="mdi-magnify"
      label="أضف منتجاً"
      placeholder="ابحث بالاسم أو الرمز"
      no-data-text="لا توجد منتجات مطابقة"
      class="mb-3"
      @update:model-value="add"
    >
      <template #item="{ props: itemProps, item }">
        <v-list-item v-bind="itemProps" :subtitle="item.raw.sku">
          <template #prepend>
            <v-avatar rounded="lg" size="36" color="surface-variant">
              <v-img v-if="item.raw.images[0]" :src="item.raw.images[0].url" cover />
              <v-icon v-else icon="mdi-package-variant-closed" />
            </v-avatar>
          </template>
          <template #append>
            <div class="text-end">
              <div class="text-body-2 numeric">
                {{ formatCurrency(item.raw.salePrice ?? item.raw.price, auth.currency) }}
              </div>
              <div
                v-if="item.raw.trackInventory"
                class="text-caption"
                :class="item.raw.availableStock > 0 ? 'text-medium-emphasis' : 'text-error'"
              >
                متاح {{ item.raw.availableStock }}
              </div>
            </div>
          </template>
        </v-list-item>
      </template>
    </v-autocomplete>

    <div v-if="!lines.length" class="text-body-2 text-medium-emphasis text-center py-4 border rounded-lg">
      لم تُضف منتجات بعد
    </div>

    <v-sheet
      v-for="line in lines"
      :key="line.key"
      border
      rounded="lg"
      class="pa-3 mb-2"
    >
      <div class="d-flex align-center ga-3 mb-2">
        <v-avatar rounded="lg" size="40" color="surface-variant">
          <v-img v-if="line.imageUrl" :src="line.imageUrl" cover />
          <v-icon v-else icon="mdi-package-variant-closed" />
        </v-avatar>
        <div class="flex-grow-1 min-w-0">
          <div class="text-body-2 font-weight-medium text-truncate">{{ line.productName }}</div>
          <div v-if="line.variantName && !line.variants" class="text-caption text-medium-emphasis">
            {{ line.variantName }}
          </div>
        </div>
        <div class="text-body-2 font-weight-bold numeric">
          {{ formatCurrency(lineTotal(line), auth.currency) }}
        </div>
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          aria-label="حذف السطر"
          @click="remove(line.key)"
        />
      </div>

      <v-row dense>
        <v-col v-if="line.variants" cols="12" sm="4">
          <v-select
            :model-value="line.variantId"
            :items="line.variants"
            item-title="name"
            item-value="id"
            label="اللون / المقاس"
            density="compact"
            :error="!line.variantId"
            hide-details
            @update:model-value="changeVariant(line, $event)"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps" :subtitle="`متاح ${item.raw.availableStock}`" />
            </template>
          </v-select>
        </v-col>
        <v-col cols="4" :sm="line.variants ? 2 : 3">
          <v-text-field
            :model-value="line.quantity"
            type="number"
            min="1"
            label="الكمية"
            density="compact"
            hide-details
            :error="line.available !== null && line.quantity > line.available"
            @update:model-value="update(line.key, { quantity: Math.max(1, Math.floor(asNumber($event, 1))) })"
          />
        </v-col>
        <v-col cols="4" :sm="line.variants ? 3 : 5">
          <v-text-field
            :model-value="line.unitPrice"
            type="number"
            min="0"
            label="سعر الوحدة"
            density="compact"
            hide-details
            @update:model-value="update(line.key, { unitPrice: asNumber($event) })"
          />
        </v-col>
        <v-col cols="4" :sm="line.variants ? 3 : 4">
          <v-text-field
            :model-value="line.discount"
            type="number"
            min="0"
            label="خصم السطر"
            density="compact"
            hide-details
            @update:model-value="update(line.key, { discount: asNumber($event) })"
          />
        </v-col>
      </v-row>

      <div
        v-if="line.available !== null && line.quantity > line.available"
        class="text-caption text-error mt-1"
      >
        المتاح {{ line.available }} فقط
      </div>
    </v-sheet>
  </div>
</template>

<style scoped>
.min-w-0 {
  min-width: 0;
}
</style>
