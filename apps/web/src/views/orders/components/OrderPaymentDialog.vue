<script setup lang="ts">
import { ref, watch } from 'vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { PAYMENT_METHOD_LABELS } from '@/constants/labels';
import { ordersService } from '@/services/orders.service';
import type { OrderDetail, PaymentMethod } from '@/types/orders';
import { formatCurrency } from '@/utils/format';

const props = defineProps<{ modelValue: boolean; order: OrderDetail }>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [order: OrderDetail];
}>();

const { submitting, errorMessage, submit } = useFormSubmit();

const paidAmount = ref<number>(0);
const paymentMethod = ref<PaymentMethod>('CASH_ON_DELIVERY');

const paymentOptions = Object.entries(PAYMENT_METHOD_LABELS).map(([value, title]) => ({
  value,
  title,
}));

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    paidAmount.value = props.order.paidAmount;
    paymentMethod.value = props.order.paymentMethod;
    errorMessage.value = null;
  },
);

async function save(): Promise<void> {
  const amount = Number(paidAmount.value);
  if (!Number.isFinite(amount) || amount < 0 || amount > props.order.total) return;

  await submit(
    () =>
      ordersService.setPayment(props.order.id, {
        paidAmount: amount,
        paymentMethod: paymentMethod.value,
      }),
    {
      successMessage: 'تم تسجيل الدفع',
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
    max-width="440"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">تسجيل الدفع</v-card-title>

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <div class="text-body-2 text-medium-emphasis mb-3">
          إجمالي الطلب
          <span class="numeric font-weight-bold">
            {{ formatCurrency(order.total, order.currency) }}
          </span>
        </div>

        <v-text-field
          v-model.number="paidAmount"
          type="number"
          min="0"
          :max="order.total"
          label="إجمالي المبلغ المستلم"
          hint="المبلغ الكلي المستلم حتى الآن، وليس دفعة إضافية"
          persistent-hint
          :rules="[
            (v: number) => (Number(v) >= 0 && Number(v) <= order.total) || 'المبلغ يتجاوز إجمالي الطلب',
          ]"
          class="mb-2"
        >
          <template #append-inner>
            <v-btn size="small" variant="text" color="primary" @click="paidAmount = order.total">
              كامل
            </v-btn>
          </template>
        </v-text-field>

        <v-select
          v-model="paymentMethod"
          :items="paymentOptions"
          label="طريقة الدفع"
          class="mt-4"
        />
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn color="primary" variant="flat" :loading="submitting" @click="save">حفظ</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
