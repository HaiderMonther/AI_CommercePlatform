<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { ordersService } from '@/services/orders.service';
import type { OrderDetail } from '@/types/orders';
import { formatCurrency } from '@/utils/format';
import { draftTotals } from '@/utils/orders';
import OrderLinesEditor from './OrderLinesEditor.vue';
import { type EditorLine, isLineComplete, lineFromItem, toPayload } from './order-lines';

const props = defineProps<{ modelValue: boolean; order: OrderDetail }>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [order: OrderDetail];
}>();

const { submitting, errorMessage, submit } = useFormSubmit();

const lines = ref<EditorLine[]>([]);

const totals = computed(() =>
  draftTotals(lines.value, props.order.discount, props.order.deliveryFee),
);

const ready = computed(
  () => lines.value.length > 0 && lines.value.every((line) => isLineComplete(line)),
);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    errorMessage.value = null;
    lines.value = props.order.items.filter((item) => item.productId).map(lineFromItem);
  },
);

async function save(): Promise<void> {
  if (!ready.value) return;

  await submit(() => ordersService.replaceItems(props.order.id, lines.value.map(toPayload)), {
    successMessage: 'تم تحديث منتجات الطلب',
    onSuccess: (order) => {
      emit('saved', order);
      emit('update:modelValue', false);
    },
  });
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    persistent
    scrollable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
        تعديل منتجات الطلب #{{ order.orderNumber }}
      </v-card-title>

      <v-divider />

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <OrderLinesEditor v-model="lines" />
      </v-card-text>

      <v-divider />

      <div class="d-flex align-center px-4 pt-3">
        <span class="text-caption text-medium-emphasis">يُحجز أو يُفك حجز فرق الكميات فقط</span>
        <v-spacer />
        <span class="text-subtitle-1 font-weight-bold">
          الإجمالي
          <span class="numeric">{{ formatCurrency(totals.total, order.currency) }}</span>
        </span>
      </div>

      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn color="primary" variant="flat" :loading="submitting" :disabled="!ready" @click="save">
          حفظ
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
