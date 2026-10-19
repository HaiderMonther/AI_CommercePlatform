<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import ConfirmDialog from '@/components/data/ConfirmDialog.vue';
import EmptyState from '@/components/data/EmptyState.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import UsageMeter from '@/components/data/UsageMeter.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import {
  COMPANY_STATUS_LABELS,
  INVOICE_STATUS_COLORS,
  INVOICE_STATUS_LABELS,
  PLAN_LABELS,
  SUBSCRIPTION_STATUS_COLORS,
  SUBSCRIPTION_STATUS_LABELS,
} from '@/constants/labels';
import { platformService } from '@/services/billing.service';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type {
  CompanyStatus,
  Invoice,
  PlanTier,
  PlatformCompany,
  PlatformCompanyRow,
} from '@/types/billing';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';

const ui = useUiStore();

const companies = ref<PlatformCompanyRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(25);
const search = ref('');
const statusFilter = ref<CompanyStatus | null>(null);
const loading = ref(false);
const loadError = ref<ApiError | null>(null);

const detail = ref<PlatformCompany | null>(null);
const detailOpen = ref(false);
const detailLoading = ref(false);
const busy = ref(false);
const newTier = ref<PlanTier | null>(null);
const extendDays = ref<number | null>(null);
const confirmPay = ref<Invoice | null>(null);

const headers = [
  { title: 'الشركة', key: 'name', sortable: false },
  { title: 'الباقة', key: 'plan', sortable: false, width: 130 },
  { title: 'الاشتراك', key: 'subscription', sortable: false, width: 170 },
  { title: 'مستحق', key: 'amountDue', sortable: false, width: 130 },
  { title: 'النشاط', key: 'counts', sortable: false, width: 150 },
  { title: 'الحالة', key: 'status', sortable: false, width: 110 },
];

const statusOptions = Object.entries(COMPANY_STATUS_LABELS).map(([value, title]) => ({
  value,
  title,
}));
const tierOptions = Object.entries(PLAN_LABELS).map(([value, title]) => ({ value, title }));

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const result = await platformService.companies({
      page: page.value,
      limit: limit.value,
      search: search.value || undefined,
      status: statusFilter.value ?? undefined,
    });
    companies.value = result.items;
    total.value = result.meta.total;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

let searchTimer: number | undefined;
watch(search, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    load();
  }, 350);
});
watch(statusFilter, () => {
  page.value = 1;
  load();
});
watch([page, limit], load);
onMounted(load);

async function open(row: PlatformCompanyRow): Promise<void> {
  detailOpen.value = true;
  detailLoading.value = true;
  detail.value = null;
  newTier.value = null;
  extendDays.value = null;
  try {
    detail.value = await platformService.company(row.id);
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذّر تحميل الشركة');
    detailOpen.value = false;
  } finally {
    detailLoading.value = false;
  }
}

function onRowClick(_event: Event, row: { item: PlatformCompanyRow }): void {
  open(row.item);
}

/** Runs an action on the open company, refreshes it and the list. */
async function act(action: () => Promise<PlatformCompany>, success: string): Promise<void> {
  busy.value = true;
  try {
    detail.value = await action();
    ui.success(success);
    newTier.value = null;
    extendDays.value = null;
    await load();
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذّر تنفيذ العملية');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="الشركات المشتركة"
      subtitle="الباقات والاشتراكات والمدفوعات لكل المتاجر على المنصة"
    />

    <v-card>
      <div class="d-flex flex-wrap ga-3 pa-4">
        <v-text-field
          v-model="search"
          placeholder="اسم الشركة أو بريدها"
          prepend-inner-icon="mdi-magnify"
          clearable
          style="min-width: 240px; max-width: 340px"
        />
        <v-select
          v-model="statusFilter"
          :items="statusOptions"
          label="الحالة"
          clearable
          style="max-width: 170px"
        />
      </div>
      <v-divider />

      <ErrorState
        v-if="loadError"
        :message="loadError.message"
        :correlation-id="loadError.correlationId"
        @retry="load"
      />

      <v-data-table-server
        v-else
        v-model:page="page"
        v-model:items-per-page="limit"
        :headers="headers"
        :items="companies"
        :items-length="total"
        :loading="loading"
        item-value="id"
        hover
        @click:row="onRowClick"
      >
        <template #item.name="{ item }">
          <div class="py-2">
            <div class="text-body-2 font-weight-medium">{{ item.name }}</div>
            <div class="text-caption text-medium-emphasis" dir="ltr">
              {{ item.email ?? item.slug }}
            </div>
          </div>
        </template>
        <template #item.plan="{ item }">{{ PLAN_LABELS[item.planTier] }}</template>
        <template #item.subscription="{ item }">
          <div v-if="item.subscription" class="d-flex flex-column">
            <v-chip
              :color="SUBSCRIPTION_STATUS_COLORS[item.subscription.status]"
              size="small"
              variant="tonal"
              class="align-self-start"
            >
              {{ SUBSCRIPTION_STATUS_LABELS[item.subscription.status] }}
            </v-chip>
            <span class="text-caption text-medium-emphasis"
              >حتى {{ formatDate(item.subscription.currentPeriodEnd) }}</span
            >
          </div>
          <span v-else class="text-medium-emphasis">—</span>
        </template>
        <template #item.amountDue="{ item }">
          <span v-if="item.openInvoices" class="text-warning font-weight-medium numeric">
            {{ formatCurrency(item.amountDue, 'USD') }}
          </span>
          <span v-else class="text-medium-emphasis">—</span>
        </template>
        <template #item.counts="{ item }">
          <span class="text-caption numeric">
            {{ formatNumber(item.counts.users) }} مستخدم ·
            {{ formatNumber(item.counts.orders) }} طلب
          </span>
        </template>
        <template #item.status="{ item }">
          <v-chip
            :color="item.status === 'SUSPENDED' ? 'error' : 'default'"
            size="small"
            variant="tonal"
          >
            {{ COMPANY_STATUS_LABELS[item.status] }}
          </v-chip>
        </template>
        <template #no-data>
          <EmptyState
            icon="mdi-domain"
            title="لا توجد شركات"
            description="تظهر هنا المتاجر عند تسجيلها."
          />
        </template>
      </v-data-table-server>
    </v-card>

    <v-dialog v-model="detailOpen" max-width="760" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold pt-4">
          {{ detail?.name ?? '…' }}
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            aria-label="إغلاق"
            @click="detailOpen = false"
          />
        </v-card-title>
        <v-divider />

        <v-card-text>
          <v-skeleton-loader v-if="detailLoading" type="article" />
          <template v-else-if="detail">
            <div class="d-flex flex-wrap ga-2 mb-4">
              <v-chip size="small" variant="tonal">{{ PLAN_LABELS[detail.planTier] }}</v-chip>
              <v-chip
                v-if="detail.subscription"
                :color="SUBSCRIPTION_STATUS_COLORS[detail.subscription.status]"
                size="small"
                variant="tonal"
              >
                {{ SUBSCRIPTION_STATUS_LABELS[detail.subscription.status] }} · حتى
                {{ formatDate(detail.subscription.currentPeriodEnd) }}
              </v-chip>
              <v-chip
                :color="detail.status === 'SUSPENDED' ? 'error' : 'default'"
                size="small"
                variant="tonal"
              >
                {{ COMPANY_STATUS_LABELS[detail.status] }}
              </v-chip>
            </div>

            <v-row dense class="mb-2">
              <v-col v-for="row in detail.usage" :key="row.metric" cols="12" sm="6">
                <UsageMeter :label="row.label" :used="row.used" :limit="row.limit" />
              </v-col>
            </v-row>

            <div class="text-subtitle-2 font-weight-bold mt-4 mb-2">الاشتراك</div>
            <div class="d-flex flex-wrap align-center ga-3">
              <v-select
                v-model="newTier"
                :items="tierOptions"
                label="نقل إلى باقة"
                hide-details
                density="compact"
                style="max-width: 200px"
              />
              <v-btn
                :disabled="!newTier"
                :loading="busy"
                variant="tonal"
                color="primary"
                @click="
                  act(
                    () => platformService.updateSubscription(detail!.id, { tier: newTier! }),
                    'تم نقل الباقة',
                  )
                "
              >
                تطبيق
              </v-btn>
              <v-text-field
                v-model.number="extendDays"
                type="number"
                min="1"
                max="365"
                label="تمديد (أيام)"
                hide-details
                density="compact"
                style="max-width: 140px"
              />
              <v-btn
                :disabled="!extendDays"
                :loading="busy"
                variant="tonal"
                @click="
                  act(
                    () =>
                      platformService.updateSubscription(detail!.id, { extendDays: extendDays! }),
                    'تم التمديد',
                  )
                "
              >
                تمديد
              </v-btn>
            </div>

            <div class="text-subtitle-2 font-weight-bold mt-6 mb-2">الفواتير</div>
            <v-table v-if="detail.invoices.length" density="compact">
              <tbody>
                <tr v-for="invoice in detail.invoices" :key="invoice.id">
                  <td class="numeric" dir="ltr">{{ invoice.number }}</td>
                  <td class="numeric">{{ formatCurrency(invoice.total, invoice.currency) }}</td>
                  <td>
                    {{ invoice.paidAt ? formatDate(invoice.paidAt) : formatDate(invoice.dueAt) }}
                  </td>
                  <td>
                    <v-chip
                      :color="INVOICE_STATUS_COLORS[invoice.status]"
                      size="x-small"
                      variant="tonal"
                    >
                      {{ INVOICE_STATUS_LABELS[invoice.status] }}
                    </v-chip>
                  </td>
                  <td class="text-end">
                    <template v-if="invoice.status === 'OPEN'">
                      <v-btn
                        size="x-small"
                        color="success"
                        variant="flat"
                        @click="confirmPay = invoice"
                      >
                        تسجيل الدفع
                      </v-btn>
                      <v-btn
                        size="x-small"
                        variant="text"
                        :loading="busy"
                        @click="
                          act(() => platformService.voidInvoice(invoice.id), 'أُلغيت الفاتورة')
                        "
                      >
                        إلغاء
                      </v-btn>
                    </template>
                  </td>
                </tr>
              </tbody>
            </v-table>
            <div v-else class="text-body-2 text-medium-emphasis">لا توجد فواتير.</div>
          </template>
        </v-card-text>

        <v-divider />
        <v-card-actions v-if="detail" class="px-4 py-3">
          <v-btn
            v-if="detail.status === 'SUSPENDED'"
            color="success"
            variant="tonal"
            :loading="busy"
            @click="
              act(() => platformService.setStatus(detail!.id, 'ACTIVE'), 'أُعيد تفعيل الشركة')
            "
          >
            إعادة التفعيل
          </v-btn>
          <v-btn
            v-else
            color="error"
            variant="text"
            :loading="busy"
            @click="act(() => platformService.setStatus(detail!.id, 'SUSPENDED'), 'أُوقفت الشركة')"
          >
            إيقاف الشركة
          </v-btn>
          <span class="text-caption text-medium-emphasis ms-2"
            >الإيقاف يمنع دخول كل أعضاء الشركة</span
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      :model-value="Boolean(confirmPay)"
      title="تسجيل الدفع"
      :message="`تأكيد استلام ${confirmPay ? formatCurrency(confirmPay.total, confirmPay.currency) : ''} عن الفاتورة ${confirmPay?.number ?? ''}؟ يُعاد تشغيل الاشتراك إن كان متوقفاً بسببها.`"
      confirm-label="تأكيد الاستلام"
      color="success"
      :loading="busy"
      @update:model-value="confirmPay = null"
      @confirm="
        act(() => platformService.markPaid(confirmPay!.id), 'سُجّل الدفع').then(
          () => (confirmPay = null),
        )
      "
    />
  </div>
</template>
