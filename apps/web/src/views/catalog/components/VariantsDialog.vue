<script setup lang="ts">
import { ref, watch } from 'vue';
import StockAdjustDialog from './StockAdjustDialog.vue';
import { PERMISSIONS } from '@/constants/permissions';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { productsService } from '@/services/catalog.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import { formatCurrency } from '@/utils/format';
import type { Product, ProductVariant } from '@/types/users';

const props = defineProps<{ modelValue: boolean; product: Product | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: [] }>();

const auth = useAuthStore();
const ui = useUiStore();
const { submitting, errorMessage, submit } = useFormSubmit();

const variants = ref<ProductVariant[]>([]);
const loading = ref(false);
const adding = ref(false);
const adjustTarget = ref<ProductVariant | null>(null);

const draft = ref({ color: '', size: '', price: null as number | null, initialStock: 0 });

async function load(): Promise<void> {
  if (!props.product) return;

  loading.value = true;
  try {
    variants.value = await productsService.listVariants(props.product.id);
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر جلب المتغيرات');
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    errorMessage.value = null;
    adding.value = false;
    draft.value = { color: '', size: '', price: null, initialStock: 0 };
    load();
  },
);

async function addVariant(): Promise<void> {
  if (!props.product) return;

  // Colour and size cover the overwhelming majority of Iraqi apparel catalogs; at least
  // one must be filled so the variant is identifiable.
  const attributes: Record<string, string> = {};
  if (draft.value.color.trim()) attributes.color = draft.value.color.trim();
  if (draft.value.size.trim()) attributes.size = draft.value.size.trim();

  if (Object.keys(attributes).length === 0) {
    errorMessage.value = 'أدخل اللون أو المقاس على الأقل';
    return;
  }

  await submit(
    () =>
      productsService.createVariant(props.product!.id, {
        attributes,
        price: draft.value.price ? Number(draft.value.price) : undefined,
        initialStock: draft.value.initialStock || undefined,
      }),
    {
      successMessage: 'تمت إضافة المتغير',
      onSuccess: async () => {
        draft.value = { color: '', size: '', price: null, initialStock: 0 };
        adding.value = false;
        await load();
        emit('changed');
      },
    },
  );
}

async function removeVariant(variant: ProductVariant): Promise<void> {
  if (!props.product) return;

  try {
    await productsService.removeVariant(props.product.id, variant.id);
    ui.success('تم حذف المتغير');
    await load();
    emit('changed');
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر حذف المتغير');
  }
}

async function onStockSaved(): Promise<void> {
  await load();
  emit('changed');
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    scrollable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
        متغيرات {{ product?.name }}
      </v-card-title>

      <v-divider />

      <v-card-text style="max-height: 66vh">
        <v-alert v-if="errorMessage" type="error" density="compact" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <v-alert
          v-if="product && !product.hasVariants"
          type="info"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          عند إضافة أول متغير يصبح مخزون المنتج مجموع مخزون متغيراته، وتُنقل الكمية
          الحالية بحركة مخزون مسجّلة.
        </v-alert>

        <v-skeleton-loader v-if="loading" type="table-row@3" />

        <v-table v-else-if="variants.length" density="comfortable">
          <thead>
            <tr>
              <th class="text-start">المتغير</th>
              <th class="text-start">الرمز</th>
              <th class="text-start">السعر</th>
              <th class="text-start">المخزون</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="variant in variants" :key="variant.id">
              <td>{{ variant.name }}</td>
              <td class="numeric text-caption">{{ variant.sku }}</td>
              <td>
                <span v-if="variant.price">{{ formatCurrency(variant.price, auth.currency) }}</span>
                <span v-else class="text-medium-emphasis text-caption">سعر المنتج</span>
              </td>
              <td>
                <v-chip
                  :color="variant.stock > 0 ? 'success' : 'error'"
                  size="small"
                  variant="tonal"
                >
                  <span class="numeric">{{ variant.stock }}</span>
                </v-chip>
                <span v-if="variant.reservedStock > 0" class="text-caption text-medium-emphasis ms-2">
                  (<span class="numeric">{{ variant.reservedStock }}</span> محجوز)
                </span>
              </td>
              <td class="text-end">
                <v-btn
                  v-if="auth.can(PERMISSIONS.INVENTORY_ADJUST)"
                  icon="mdi-warehouse"
                  size="x-small"
                  variant="text"
                  title="تعديل المخزون"
                  @click="adjustTarget = variant"
                />
                <v-btn
                  v-if="auth.can(PERMISSIONS.PRODUCTS_DELETE)"
                  icon="mdi-delete-outline"
                  size="x-small"
                  variant="text"
                  color="error"
                  @click="removeVariant(variant)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>

        <div v-else class="text-center py-6 text-medium-emphasis">
          لا توجد متغيرات لهذا المنتج بعد.
        </div>

        <v-divider class="my-4" />

        <v-btn
          v-if="!adding && auth.can(PERMISSIONS.PRODUCTS_UPDATE)"
          variant="tonal"
          prepend-icon="mdi-plus"
          @click="adding = true"
        >
          إضافة متغير
        </v-btn>

        <v-row v-if="adding" dense>
          <v-col cols="12" sm="3">
            <v-text-field v-model="draft.color" label="اللون" placeholder="أسود" />
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field v-model="draft.size" label="المقاس" placeholder="L" />
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field
              v-model.number="draft.price"
              label="سعر خاص"
              type="number"
              min="0"
              placeholder="اختياري"
            />
          </v-col>
          <v-col cols="12" sm="3">
            <v-text-field v-model.number="draft.initialStock" label="الكمية" type="number" min="0" />
          </v-col>
          <v-col cols="12" class="d-flex ga-2">
            <v-btn color="primary" :loading="submitting" @click="addVariant">حفظ المتغير</v-btn>
            <v-btn variant="text" @click="adding = false">إلغاء</v-btn>
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">إغلاق</v-btn>
      </v-card-actions>
    </v-card>

    <StockAdjustDialog
      :model-value="Boolean(adjustTarget)"
      :product="product"
      :variant="adjustTarget"
      @update:model-value="adjustTarget = null"
      @saved="onStockSaved"
    />
  </v-dialog>
</template>
