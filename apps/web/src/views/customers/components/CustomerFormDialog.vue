<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { CUSTOMER_STATUS_LABELS } from '@/constants/labels';
import { customersService, type CustomerPayload } from '@/services/crm.service';
import type { Customer, CustomerDetail, CustomerStatus } from '@/types/crm';

const props = defineProps<{
  modelValue: boolean;
  customer: Customer | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [customer: CustomerDetail];
}>();

const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const formRef = ref();

const empty = () => ({
  name: '',
  phone: '',
  altPhone: '',
  email: '',
  city: '',
  address: '',
  notes: '',
  tags: [] as string[],
  status: 'ACTIVE' as CustomerStatus,
});

const form = ref(empty());

const isEdit = computed(() => Boolean(props.customer));

// ARCHIVED is what deletion sets; it is not a state to pick by hand.
const statusOptions = Object.entries(CUSTOMER_STATUS_LABELS)
  .filter(([value]) => value !== 'ARCHIVED')
  .map(([value, title]) => ({ value, title }));

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;

    errorMessage.value = null;
    fieldErrors.value = [];

    const customer = props.customer;
    form.value = customer
      ? {
          name: customer.name,
          phone: customer.phone ?? '',
          altPhone: customer.altPhone ?? '',
          email: customer.email ?? '',
          city: customer.city ?? '',
          address: customer.address ?? '',
          notes: customer.notes ?? '',
          tags: [...customer.tags],
          status: customer.status,
        }
      : empty();
  },
);

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  // On edit, a cleared field is sent as null so the API clears it; on create it is omitted.
  const optional = (value: string) => value.trim() || (isEdit.value ? null : undefined);

  const payload: CustomerPayload = {
    name: form.value.name.trim(),
    phone: optional(form.value.phone),
    altPhone: optional(form.value.altPhone),
    email: optional(form.value.email),
    city: optional(form.value.city),
    address: optional(form.value.address),
    notes: optional(form.value.notes),
    tags: form.value.tags,
    ...(isEdit.value ? { status: form.value.status } : {}),
  };

  await submit(
    () =>
      props.customer
        ? customersService.update(props.customer.id, payload)
        : customersService.create(payload),
    {
      successMessage: props.customer ? 'تم تحديث بيانات الزبون' : 'تمت إضافة الزبون',
      onSuccess: (saved) => {
        emit('saved', saved);
        emit('update:modelValue', false);
      },
    },
  );
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="620"
    persistent
    scrollable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
        {{ isEdit ? 'تعديل بيانات الزبون' : 'إضافة زبون' }}
      </v-card-title>

      <v-divider />

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
          <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
            <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
          </ul>
        </v-alert>

        <v-form ref="formRef" @submit.prevent="onSubmit">
          <v-text-field
            v-model="form.name"
            label="الاسم"
            :rules="[rules.required(), rules.minLength(2), rules.maxLength(120)]"
            class="mb-4"
          />

          <v-row dense>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.phone"
                label="رقم الهاتف"
                dir="ltr"
                placeholder="07701234567"
                hint="يُحفظ بالصيغة الدولية تلقائياً"
                :rules="[rules.phone()]"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.altPhone"
                label="رقم بديل"
                dir="ltr"
                :rules="[rules.phone()]"
              />
            </v-col>
          </v-row>

          <v-row dense class="mt-1">
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.email"
                label="البريد الإلكتروني"
                type="email"
                dir="ltr"
                :rules="[rules.email()]"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="form.city" label="المدينة" :rules="[rules.maxLength(80)]" />
            </v-col>
          </v-row>

          <v-text-field
            v-model="form.address"
            label="العنوان"
            :rules="[rules.maxLength(300)]"
            class="mt-1 mb-4"
          />

          <v-combobox
            v-model="form.tags"
            label="الوسوم"
            multiple
            chips
            closable-chips
            hint="اكتب الوسم ثم Enter"
            class="mb-4"
          />

          <v-textarea
            v-model="form.notes"
            label="ملاحظات داخلية"
            rows="2"
            auto-grow
            :rules="[rules.maxLength(2000)]"
            class="mb-4"
          />

          <v-select v-if="isEdit" v-model="form.status" :items="statusOptions" label="الحالة" />
        </v-form>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn color="primary" :loading="submitting" @click="onSubmit">حفظ</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
