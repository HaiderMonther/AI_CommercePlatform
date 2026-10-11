<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { ORDER_STATUS_ACTIONS, ORDER_STATUS_LABELS } from '@/constants/labels';
import { ordersService } from '@/services/orders.service';
import type { OrderDetail, OrderStatus } from '@/types/orders';

const props = defineProps<{
  modelValue: boolean;
  order: OrderDetail;
  target: OrderStatus | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [order: OrderDetail];
}>();

const { submitting, errorMessage, submit } = useFormSubmit();

const note = ref('');
const cancelReason = ref('');

const cancelling = computed(() => props.target === 'CANCELLED');

/** What the move does to stock, so the agent knows before confirming. */
const stockHint = computed(() => {
  if (!props.target) return null;
  const shipped = props.order.status === 'SHIPPED';

  if (cancelling.value) {
    return shipped
      ? 'ستُعاد كميات المنتجات إلى المخزون كمرتجع.'
      : 'سيُفك حجز كميات المنتجات وتعود متاحة للبيع.';
  }
  if ((props.target === 'SHIPPED' || props.target === 'DELIVERED') && !shipped) {
    return 'ستُخصم الكميات المحجوزة من المخزون كمبيعات.';
  }
  return null;
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    note.value = '';
    cancelReason.value = '';
    errorMessage.value = null;
  },
);

async function confirm(): Promise<void> {
  if (!props.target) return;
  if (cancelling.value && cancelReason.value.trim().length < 2) return;

  await submit(
    () =>
      ordersService.setStatus(props.order.id, {
        status: props.target!,
        note: note.value.trim() || undefined,
        cancelReason: cancelling.value ? cancelReason.value.trim() : undefined,
      }),
    {
      successMessage: `أصبح الطلب «${ORDER_STATUS_LABELS[props.target]}»`,
      onSuccess: (order) => {
        emit('saved', order);
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
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card v-if="target">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
        {{ ORDER_STATUS_ACTIONS[target] }} #{{ order.orderNumber }}
      </v-card-title>

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <v-alert
          v-if="stockHint"
          type="info"
          variant="tonal"
          density="compact"
          icon="mdi-warehouse"
          class="mb-4 text-body-2"
        >
          {{ stockHint }}
        </v-alert>

        <v-textarea
          v-if="cancelling"
          v-model="cancelReason"
          label="سبب الإلغاء"
          rows="2"
          auto-grow
          autofocus
          :rules="[(v: string) => v.trim().length >= 2 || 'اكتب سبب الإلغاء']"
        />
        <v-text-field v-else v-model="note" label="ملاحظة (اختياري)" />
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          تراجع
        </v-btn>
        <v-btn
          :color="cancelling ? 'error' : 'primary'"
          variant="flat"
          :loading="submitting"
          @click="confirm"
        >
          {{ ORDER_STATUS_ACTIONS[target] }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
