<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { MANUAL_MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS } from '@/constants/labels';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { inventoryService } from '@/services/catalog.service';
import type { Product, ProductVariant } from '@/types/users';

const props = defineProps<{
  modelValue: boolean;
  product: Product | null;
  variant?: ProductVariant | null;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>();

const { submitting, errorMessage, submit } = useFormSubmit();

const type = ref<'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT' | 'RETURN'>('STOCK_IN');
const quantity = ref<number | null>(null);
const reason = ref('');

const typeOptions = MANUAL_MOVEMENT_TYPES.map((value) => ({
  value,
  title: MOVEMENT_TYPE_LABELS[value],
}));

const currentStock = computed(() => props.variant?.stock ?? props.product?.stock ?? 0);

/** ADJUSTMENT sets an absolute total; the others shift by the amount entered. */
const isCount = computed(() => type.value === 'ADJUSTMENT');

const resultingStock = computed(() => {
  const amount = Number(quantity.value ?? 0);
  if (!Number.isFinite(amount)) return currentStock.value;

  switch (type.value) {
    case 'ADJUSTMENT':
      return amount;
    case 'STOCK_IN':
    case 'RETURN':
      return currentStock.value + amount;
    default:
      return currentStock.value - amount;
  }
});

const wouldGoNegative = computed(() => resultingStock.value < 0);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    errorMessage.value = null;
    type.value = 'STOCK_IN';
    quantity.value = null;
    reason.value = '';
  },
);

async function onSubmit(): Promise<void> {
  if (quantity.value === null || wouldGoNegative.value || !props.product) return;

  await submit(
    () =>
      inventoryService.adjust({
        productId: props.product!.id,
        variantId: props.variant?.id,
        type: type.value,
        quantity: Number(quantity.value),
        reason: reason.value || undefined,
      }),
    {
      successMessage: 'تم تحديث المخزون',
      onSuccess: () => {
        emit('saved');
        emit('update:modelValue', false);
      },
    },
  );
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">تعديل المخزون</v-card-title>

      <v-divider />

      <v-card-text>
        <div class="text-body-2 mb-1">{{ product?.name }}</div>
        <div class="text-caption text-medium-emphasis numeric mb-4">
          {{ variant?.sku ?? product?.sku }}
          <span v-if="variant"> — {{ variant.name }}</span>
        </div>

        <v-alert v-if="errorMessage" type="error" density="compact" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <v-select v-model="type" :items="typeOptions" label="نوع الحركة" class="mb-4" />

        <v-text-field
          v-model.number="quantity"
          :label="isCount ? 'الكمية الفعلية بعد الجرد' : 'الكمية'"
          type="number"
          min="0"
          :hint="isCount ? 'أدخل ما وجدته فعلياً، وسيُحسب الفرق تلقائياً' : undefined"
          :persistent-hint="isCount"
          class="mb-4"
        />

        <v-text-field v-model="reason" label="السبب (اختياري)" class="mb-4" />

        <v-alert :type="wouldGoNegative ? 'error' : 'info'" density="compact" variant="tonal">
          <div class="d-flex justify-space-between">
            <span>الكمية الحالية</span>
            <strong class="numeric">{{ currentStock }}</strong>
          </div>
          <div class="d-flex justify-space-between mt-1">
            <span>بعد الحركة</span>
            <strong class="numeric">{{ resultingStock }}</strong>
          </div>
          <div v-if="wouldGoNegative" class="mt-2 text-caption">
            لا يمكن أن يصبح المخزون بالسالب.
          </div>
        </v-alert>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn
          color="primary"
          :loading="submitting"
          :disabled="quantity === null || wouldGoNegative"
          @click="onSubmit"
        >
          تأكيد
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
