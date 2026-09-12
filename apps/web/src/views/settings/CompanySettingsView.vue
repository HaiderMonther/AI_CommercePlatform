<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import { PERMISSIONS } from '@/constants/permissions';
import { COMPANY_STATUS_LABELS, PLAN_LABELS } from '@/constants/labels';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { companyService } from '@/services/company.service';
import { useAuthStore } from '@/stores/auth.store';
import { ApiError } from '@/types/api';
import { formatDate } from '@/utils/format';
import type { Company } from '@/types/users';

const auth = useAuthStore();
const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const company = ref<Company | null>(null);
const loading = ref(false);
const loadError = ref<ApiError | null>(null);
const formRef = ref();

const form = ref({
  name: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  currency: 'IQD',
  timezone: 'Asia/Baghdad',
});

const canUpdate = computed(() => auth.can(PERMISSIONS.COMPANY_UPDATE));

const currencies = [
  { value: 'IQD', title: 'الدينار العراقي (د.ع)' },
  { value: 'USD', title: 'الدولار الأمريكي ($)' },
];

const timezones = [
  { value: 'Asia/Baghdad', title: 'بغداد (GMT+3)' },
  { value: 'Asia/Dubai', title: 'دبي (GMT+4)' },
  { value: 'Asia/Riyadh', title: 'الرياض (GMT+3)' },
];

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;

  try {
    const result = await companyService.get();
    company.value = result;
    form.value = {
      name: result.name,
      phone: result.phone ?? '',
      email: result.email ?? '',
      address: result.address ?? '',
      city: result.city ?? '',
      currency: result.currency,
      timezone: result.timezone,
    };
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  await submit(
    () =>
      companyService.update({
        name: form.value.name,
        phone: form.value.phone || undefined,
        email: form.value.email || undefined,
        address: form.value.address || undefined,
        city: form.value.city || undefined,
        currency: form.value.currency,
        timezone: form.value.timezone,
      }),
    {
      successMessage: 'تم حفظ بيانات الشركة',
      onSuccess: (updated) => {
        company.value = updated;
        if (auth.company) {
          auth.company.name = updated.name;
          auth.company.currency = updated.currency;
        }
      },
    },
  );
}
</script>

<template>
  <div>
    <PageHeader title="إعدادات الشركة" subtitle="البيانات التي تظهر للزبائن وتُستخدم في الفواتير" />

    <ErrorState
      v-if="loadError"
      :message="loadError.message"
      :correlation-id="loadError.correlationId"
      @retry="load"
    />

    <v-row v-else dense>
      <v-col cols="12" lg="8">
        <v-card class="pa-4 pa-md-6">
          <v-skeleton-loader v-if="loading" type="article, actions" />

          <v-form v-else ref="formRef" @submit.prevent="onSubmit">
            <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
              {{ errorMessage }}
              <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
                <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
              </ul>
            </v-alert>

            <v-row dense>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="form.name"
                  label="اسم الشركة"
                  :readonly="!canUpdate"
                  :rules="[rules.required(), rules.minLength(2)]"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  :model-value="company?.slug"
                  label="المعرف الفريد"
                  dir="ltr"
                  readonly
                  hint="يُستخدم في الروابط ولا يمكن تغييره"
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="form.phone"
                  label="رقم الهاتف"
                  dir="ltr"
                  :readonly="!canUpdate"
                  :rules="[rules.phone()]"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="form.email"
                  label="البريد الإلكتروني"
                  dir="ltr"
                  :readonly="!canUpdate"
                  :rules="[rules.email()]"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.city" label="المدينة" :readonly="!canUpdate" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="form.address" label="العنوان" :readonly="!canUpdate" />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="form.currency"
                  :items="currencies"
                  label="العملة"
                  :readonly="!canUpdate"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="form.timezone"
                  :items="timezones"
                  label="المنطقة الزمنية"
                  :readonly="!canUpdate"
                />
              </v-col>
            </v-row>

            <div v-if="canUpdate" class="d-flex justify-end mt-6">
              <v-btn color="primary" type="submit" :loading="submitting">حفظ التغييرات</v-btn>
            </div>
          </v-form>
        </v-card>
      </v-col>

      <v-col cols="12" lg="4">
        <v-card class="pa-4">
          <div class="text-subtitle-2 font-weight-bold mb-3">الاشتراك</div>

          <div class="d-flex align-center justify-space-between mb-3">
            <span class="text-body-2 text-medium-emphasis">الباقة</span>
            <v-chip color="primary" size="small" variant="tonal">
              {{ PLAN_LABELS[company?.planTier ?? ''] ?? '—' }}
            </v-chip>
          </div>

          <div class="d-flex align-center justify-space-between mb-3">
            <span class="text-body-2 text-medium-emphasis">الحالة</span>
            <v-chip
              :color="company?.status === 'ACTIVE' ? 'success' : 'warning'"
              size="small"
              variant="tonal"
            >
              {{ COMPANY_STATUS_LABELS[company?.status ?? ''] ?? '—' }}
            </v-chip>
          </div>

          <div v-if="company?.trialEndsAt" class="d-flex align-center justify-space-between">
            <span class="text-body-2 text-medium-emphasis">تنتهي التجربة</span>
            <span class="text-body-2">{{ formatDate(company.trialEndsAt) }}</span>
          </div>

          <v-divider class="my-4" />

          <div class="text-caption text-medium-emphasis">
            إدارة الفواتير وتغيير الباقة ستتوفر مع وحدة الاشتراكات في المرحلة 8.
          </div>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
