<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { MANUAL_ORDER_DELIVERY_STATUSES, ORDER_DELIVERY_STATUS_LABELS } from '@/constants/labels';
import { ordersService, type UpdateOrderPayload } from '@/services/orders.service';
import type { OrderDeliveryStatus, OrderDetail } from '@/types/orders';

const props = defineProps<{ modelValue: boolean; order: OrderDetail }>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [order: OrderDetail];
}>();

const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const formRef = ref();
const form = ref({
  customerName: '',
  customerPhone: '',
  deliveryCity: '',
  deliveryAddress: '',
  notes: '',
  deliveryFee: 0,
  discount: 0,
  deliveryStatus: 'PENDING' as OrderDeliveryStatus,
});

/** A delivered or cancelled order keeps only its notes editable. */
const open = computed(() => !['DELIVERED', 'CANCELLED'].includes(props.order.status));

const deliveryOptions = MANUAL_ORDER_DELIVERY_STATUSES.map((value) => ({
  value,
  title: ORDER_DELIVERY_STATUS_LABELS[value],
}));

const deliveryStatusEditable = computed(
  () =>
    open.value &&
    (MANUAL_ORDER_DELIVERY_STATUSES as readonly string[]).includes(props.order.deliveryStatus),
);

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return;
    errorMessage.value = null;
    fieldErrors.value = [];
    const order = props.order;
    form.value = {
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      deliveryCity: order.deliveryCity ?? '',
      deliveryAddress: order.deliveryAddress ?? '',
      notes: order.notes ?? '',
      deliveryFee: order.deliveryFee,
      discount: order.discount,
      deliveryStatus: order.deliveryStatus,
    };
  },
);

async function save(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  const order = props.order;
  const value = form.value;

  // Only what changed is sent, so a closed order can still have its notes edited.
  const payload: UpdateOrderPayload = {};
  if (value.notes !== (order.notes ?? '')) payload.notes = value.notes;

  if (open.value) {
    if (value.customerName.trim() !== order.customerName) payload.customerName = value.customerName.trim();
    if (value.customerPhone.trim() !== order.customerPhone) payload.customerPhone = value.customerPhone.trim();
    if (value.deliveryCity !== (order.deliveryCity ?? '')) payload.deliveryCity = value.deliveryCity;
    if (value.deliveryAddress !== (order.deliveryAddress ?? '')) payload.deliveryAddress = value.deliveryAddress;
    if (deliveryStatusEditable.value && value.deliveryStatus !== order.deliveryStatus) {
      payload.deliveryStatus = value.deliveryStatus;
    }
  }

  if (order.pricingEditable) {
    if (Number(value.deliveryFee) !== order.deliveryFee) payload.deliveryFee = Number(value.deliveryFee) || 0;
    if (Number(value.discount) !== order.discount) payload.discount = Number(value.discount) || 0;
  }

  if (Object.keys(payload).length === 0) {
    emit('update:modelValue', false);
    return;
  }

  await submit(() => ordersService.update(order.id, payload), {
    successMessage: 'تم تحديث الطلب',
    onSuccess: (saved) => {
      emit('saved', saved);
      emit('update:modelValue', false);
    },
  });
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="580"
    persistent
    scrollable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">تعديل بيانات الطلب</v-card-title>

      <v-divider />

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
          <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
            <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
          </ul>
        </v-alert>

        <v-form ref="formRef" @submit.prevent="save">
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.customerName"
                label="اسم المستلم"
                :disabled="!open"
                :rules="[rules.required(), rules.minLength(2), rules.maxLength(120)]"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.customerPhone"
                label="هاتف المستلم"
                dir="ltr"
                :disabled="!open"
                :rules="[rules.required(), rules.phone()]"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <v-text-field
                v-model="form.deliveryCity"
                label="المدينة"
                :disabled="!open"
                :rules="[rules.maxLength(80)]"
              />
            </v-col>
            <v-col cols="12" sm="8">
              <v-text-field
                v-model="form.deliveryAddress"
                label="العنوان"
                :disabled="!open"
                :rules="[rules.maxLength(300)]"
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model.number="form.deliveryFee"
                type="number"
                min="0"
                label="أجور التوصيل"
                :disabled="!order.pricingEditable"
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model.number="form.discount"
                type="number"
                min="0"
                label="خصم الطلب"
                :disabled="!order.pricingEditable"
              />
            </v-col>
            <v-col v-if="deliveryStatusEditable" cols="12">
              <v-select
                v-model="form.deliveryStatus"
                :items="deliveryOptions"
                label="حالة التوصيل"
                hint="الوصول والإرجاع يتبعان حالة الطلب تلقائياً"
                persistent-hint
              />
            </v-col>
          </v-row>

          <v-textarea
            v-model="form.notes"
            label="ملاحظات"
            rows="2"
            auto-grow
            class="mt-3"
            :rules="[rules.maxLength(2000)]"
          />

          <div v-if="!order.pricingEditable && open" class="text-caption text-medium-emphasis">
            الخصم وأجور التوصيل لا تتغير بعد شحن الطلب.
          </div>
        </v-form>
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
