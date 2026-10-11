<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { PAYMENT_METHOD_LABELS } from '@/constants/labels';
import { customersService } from '@/services/crm.service';
import { ordersService, type CreateOrderPayload } from '@/services/orders.service';
import { useAuthStore } from '@/stores/auth.store';
import type { Customer } from '@/types/crm';
import type { OrderDetail, PaymentMethod } from '@/types/orders';
import { formatCurrency } from '@/utils/format';
import { draftTotals } from '@/utils/orders';
import OrderLinesEditor from './OrderLinesEditor.vue';
import { type EditorLine, type PresetCustomer, isLineComplete, toPayload } from './order-lines';

const props = defineProps<{
  modelValue: boolean;
  customer?: PresetCustomer | null;
  conversationId?: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [order: OrderDetail];
}>();

const auth = useAuthStore();
const router = useRouter();
const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const formRef = ref();

const customerMode = ref<'existing' | 'new'>('existing');
const selectedCustomer = ref<PresetCustomer | null>(null);
const customerSearch = ref('');
const customerResults = ref<Customer[]>([]);
const customerLoading = ref(false);

const newCustomer = ref({ name: '', phone: '' });

const lines = ref<EditorLine[]>([]);
const delivery = ref({ city: '', address: '', phone: '' });
const deliveryFee = ref<number | null>(null);
const discount = ref<number | null>(null);
const paymentMethod = ref<PaymentMethod>('CASH_ON_DELIVERY');
const notes = ref('');

const paymentOptions = Object.entries(PAYMENT_METHOD_LABELS).map(([value, title]) => ({
  value,
  title,
}));

const totals = computed(() =>
  draftTotals(lines.value, Number(discount.value ?? 0), Number(deliveryFee.value ?? 0)),
);

const linesReady = computed(
  () => lines.value.length > 0 && lines.value.every((line) => isLineComplete(line)),
);

const customerChosen = computed(() =>
  customerMode.value === 'existing' ? Boolean(selectedCustomer.value) : true,
);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;

    errorMessage.value = null;
    fieldErrors.value = [];
    lines.value = [];
    deliveryFee.value = null;
    discount.value = null;
    paymentMethod.value = 'CASH_ON_DELIVERY';
    notes.value = '';
    newCustomer.value = { name: '', phone: '' };
    customerMode.value = 'existing';
    selectedCustomer.value = props.customer ?? null;
    fillDeliveryFrom(props.customer ?? null);
    if (!props.customer) searchCustomers('');
  },
);

watch(selectedCustomer, (customer) => {
  if (customer && !props.customer) fillDeliveryFrom(customer);
});

function fillDeliveryFrom(customer: PresetCustomer | null): void {
  delivery.value = {
    city: customer?.city ?? '',
    address: customer?.address ?? '',
    phone: '',
  };
}

let customerTimer: number | undefined;

watch(customerSearch, (value) => {
  window.clearTimeout(customerTimer);
  customerTimer = window.setTimeout(() => searchCustomers(value ?? ''), 300);
});

async function searchCustomers(term: string): Promise<void> {
  customerLoading.value = true;
  try {
    const page = await customersService.list({
      search: term.trim() || undefined,
      status: 'ACTIVE',
      limit: 20,
      sortBy: 'lastContactAt',
    });
    customerResults.value = page.items;
  } catch {
    customerResults.value = [];
  } finally {
    customerLoading.value = false;
  }
}

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid || !linesReady.value || !customerChosen.value) return;

  const optional = (value: string) => value.trim() || undefined;

  const payload: CreateOrderPayload = {
    ...(customerMode.value === 'existing'
      ? { customerId: selectedCustomer.value!.id }
      : {
          customer: {
            name: newCustomer.value.name.trim(),
            phone: newCustomer.value.phone.trim(),
            city: optional(delivery.value.city),
            address: optional(delivery.value.address),
          },
        }),
    ...(props.conversationId ? { conversationId: props.conversationId } : {}),
    items: lines.value.map(toPayload),
    paymentMethod: paymentMethod.value,
    deliveryFee: Number(deliveryFee.value ?? 0) || undefined,
    discount: Number(discount.value ?? 0) || undefined,
    deliveryCity: optional(delivery.value.city),
    deliveryAddress: optional(delivery.value.address),
    customerPhone: optional(delivery.value.phone),
    notes: optional(notes.value),
  };

  await submit(() => ordersService.create(payload), {
    successMessage: 'تم إنشاء الطلب',
    onSuccess: (order) => {
      emit('saved', order);
      emit('update:modelValue', false);
      router.push({ name: 'order-detail', params: { id: order.id } });
    },
  });
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    persistent
    scrollable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">طلب جديد</v-card-title>

      <v-divider />

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
          <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
            <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
          </ul>
        </v-alert>

        <v-form ref="formRef" @submit.prevent="onSubmit">
          <div class="text-subtitle-2 font-weight-bold mb-2">الزبون</div>

          <v-sheet v-if="props.customer" border rounded="lg" class="d-flex align-center ga-3 pa-3 mb-4">
            <v-icon icon="mdi-account-outline" />
            <div>
              <div class="text-body-2 font-weight-medium">{{ props.customer.name }}</div>
              <div class="text-caption text-medium-emphasis" dir="ltr">
                {{ props.customer.phone ?? 'بلا رقم هاتف' }}
              </div>
            </div>
          </v-sheet>

          <template v-else>
            <v-btn-toggle
              v-model="customerMode"
              mandatory
              density="comfortable"
              color="primary"
              variant="outlined"
              class="mb-3"
            >
              <v-btn value="existing">زبون موجود</v-btn>
              <v-btn value="new">زبون جديد</v-btn>
            </v-btn-toggle>

            <v-autocomplete
              v-if="customerMode === 'existing'"
              v-model="selectedCustomer"
              v-model:search="customerSearch"
              :items="customerResults"
              :loading="customerLoading"
              item-title="name"
              item-value="id"
              return-object
              no-filter
              clearable
              label="ابحث بالاسم أو الهاتف"
              no-data-text="لا يوجد زبائن مطابقون"
              :rules="[rules.required('اختر الزبون')]"
              class="mb-2"
            >
              <template #item="{ props: itemProps, item }">
                <v-list-item v-bind="itemProps" :subtitle="item.raw.phone ?? item.raw.city ?? ''" />
              </template>
            </v-autocomplete>

            <v-row v-else dense class="mb-2">
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newCustomer.name"
                  label="اسم الزبون"
                  :rules="[rules.required(), rules.minLength(2), rules.maxLength(120)]"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newCustomer.phone"
                  label="رقم الهاتف"
                  dir="ltr"
                  placeholder="07701234567"
                  hint="إن وُجد زبون بنفس الرقم يُربط الطلب به"
                  :rules="[rules.required(), rules.phone()]"
                />
              </v-col>
            </v-row>
          </template>

          <div class="text-subtitle-2 font-weight-bold mb-2">المنتجات</div>
          <OrderLinesEditor v-model="lines" class="mb-4" />

          <div class="text-subtitle-2 font-weight-bold mb-2">التوصيل والدفع</div>
          <v-row dense>
            <v-col cols="12" sm="4">
              <v-text-field
                v-model="delivery.city"
                label="المدينة"
                :rules="[rules.maxLength(80)]"
              />
            </v-col>
            <v-col cols="12" sm="8">
              <v-text-field
                v-model="delivery.address"
                label="العنوان"
                :rules="[rules.maxLength(300)]"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <v-text-field
                v-model="delivery.phone"
                label="هاتف الاستلام"
                dir="ltr"
                hint="الافتراضي هاتف الزبون"
                :rules="[rules.phone()]"
              />
            </v-col>
            <v-col cols="6" sm="4">
              <v-text-field
                v-model.number="deliveryFee"
                type="number"
                min="0"
                label="أجور التوصيل"
              />
            </v-col>
            <v-col cols="6" sm="4">
              <v-text-field v-model.number="discount" type="number" min="0" label="خصم الطلب" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select v-model="paymentMethod" :items="paymentOptions" label="طريقة الدفع" />
            </v-col>
          </v-row>

          <v-textarea
            v-model="notes"
            label="ملاحظات"
            rows="2"
            auto-grow
            :rules="[rules.maxLength(2000)]"
            class="mt-1"
          />
        </v-form>
      </v-card-text>

      <v-divider />

      <div class="d-flex flex-wrap align-center ga-4 px-4 pt-3">
        <div class="text-body-2 text-medium-emphasis">
          المنتجات
          <span class="numeric">{{ formatCurrency(totals.subtotal, auth.currency) }}</span>
        </div>
        <v-spacer />
        <div class="text-subtitle-1 font-weight-bold">
          الإجمالي
          <span class="numeric">{{ formatCurrency(totals.total, auth.currency) }}</span>
        </div>
      </div>

      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="submitting"
          :disabled="!linesReady || !customerChosen"
          @click="onSubmit"
        >
          إنشاء الطلب
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
