<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ConfirmDialog from '@/components/data/ConfirmDialog.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import UsageMeter from '@/components/data/UsageMeter.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import {
  INVOICE_STATUS_COLORS,
  INVOICE_STATUS_LABELS,
  SUBSCRIPTION_STATUS_COLORS,
  SUBSCRIPTION_STATUS_LABELS,
} from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { billingService } from '@/services/billing.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type { BillingOverview, Invoice, LimitMetric, Plan } from '@/types/billing';
import { formatCurrency, formatDate, formatNumber } from '@/utils/format';

const auth = useAuthStore();
const ui = useUiStore();

const overview = ref<BillingOverview | null>(null);
const invoices = ref<Invoice[]>([]);
const loading = ref(false);
const loadError = ref<ApiError | null>(null);
const busy = ref(false);

const planTarget = ref<Plan | null>(null);
const cancelOpen = ref(false);

const canManage = computed(() => auth.can(PERMISSIONS.BILLING_MANAGE));
const subscription = computed(() => overview.value?.subscription ?? null);
const restricted = computed(
  () => !subscription.value || subscription.value.standing === 'restricted',
);

const METRIC_UNITS: Record<LimitMetric, string> = {
  USERS: 'مستخدم',
  PRODUCTS: 'منتج',
  CHANNELS: 'قناة',
  AI_MESSAGES: 'رد',
};

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    [overview.value, invoices.value] = await Promise.all([
      billingService.overview(),
      billingService.invoices(),
    ]);
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const price = (plan: Plan) =>
  plan.priceMonthly === 0
    ? 'مجاناً'
    : `${formatCurrency(plan.priceMonthly, plan.currency)} / شهرياً`;

const limitText = (plan: Plan, metric: LimitMetric) => {
  const value = plan.limits[metric];
  return value === undefined || value < 0
    ? 'بلا حد'
    : `${formatNumber(value)} ${METRIC_UNITS[metric]}`;
};

function isCurrent(plan: Plan): boolean {
  return !restricted.value && subscription.value?.plan.tier === plan.tier;
}

async function changePlan(): Promise<void> {
  if (!planTarget.value) return;
  busy.value = true;
  try {
    overview.value = await billingService.changePlan(planTarget.value.tier);
    invoices.value = await billingService.invoices();
    ui.success(`انتقلت لباقة ${planTarget.value.nameAr}`);
    planTarget.value = null;
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذّر تغيير الباقة');
  } finally {
    busy.value = false;
  }
}

async function setCancel(cancel: boolean): Promise<void> {
  busy.value = true;
  try {
    overview.value = await billingService.setCancel(cancel);
    ui.success(cancel ? 'لن يتجدد الاشتراك بعد نهاية الفترة' : 'سيتجدد الاشتراك تلقائياً');
    cancelOpen.value = false;
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذّر تحديث الاشتراك');
  } finally {
    busy.value = false;
  }
}

const periodLabel = computed(() => {
  const value = subscription.value;
  if (!value) return '';
  if (value.status === 'TRIALING')
    return `تنتهي الفترة التجريبية ${formatDate(value.currentPeriodEnd)}`;
  if (value.standing === 'restricted') return 'توقف الاشتراك';
  return value.cancelAtPeriodEnd
    ? `ينتهي الاشتراك ${formatDate(value.currentPeriodEnd)} دون تجديد`
    : `يتجدد ${formatDate(value.currentPeriodEnd)}`;
});
</script>

<template>
  <div>
    <PageHeader title="الاشتراك والباقة" subtitle="باقتك، استهلاكك من حدودها، وفواتيرك" />

    <ErrorState
      v-if="loadError"
      :message="loadError.message"
      :correlation-id="loadError.correlationId"
      @retry="load"
    />

    <v-skeleton-loader v-else-if="loading && !overview" type="card, card" />

    <template v-else-if="overview">
      <v-alert v-if="restricted" type="error" variant="tonal" class="mb-4" title="الاشتراك متوقف">
        المتجر يعمل بوضع محدود: بياناتك محفوظة ويمكنك الاطلاع عليها، لكن المساعد الذكي متوقف ولا
        يمكن إضافة مستخدمين أو منتجات أو قنوات. اختر باقة أدناه أو ادفع الفاتورة المستحقة.
      </v-alert>
      <v-alert
        v-else-if="subscription?.status === 'PAST_DUE'"
        type="warning"
        variant="tonal"
        class="mb-4"
      >
        فاتورة الاشتراك متأخرة. المتجر يعمل خلال فترة السماح، ثم يتوقف المساعد الذكي وإضافة
        البيانات.
      </v-alert>

      <v-row>
        <v-col cols="12" md="5">
          <v-card class="h-100">
            <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
              باقتك الحالية
              <v-spacer />
              <v-chip
                v-if="subscription"
                :color="SUBSCRIPTION_STATUS_COLORS[subscription.status]"
                size="small"
                variant="tonal"
              >
                {{ SUBSCRIPTION_STATUS_LABELS[subscription.status] }}
              </v-chip>
            </v-card-title>
            <v-card-text v-if="subscription">
              <div class="text-h5 font-weight-bold">{{ subscription.plan.nameAr }}</div>
              <div class="text-body-2 text-medium-emphasis mb-1 numeric">
                {{ price(subscription.plan) }}
              </div>
              <div class="text-body-2 mb-4">{{ periodLabel }}</div>

              <div class="d-flex flex-column ga-4">
                <UsageMeter
                  v-for="row in overview.usage"
                  :key="row.metric"
                  :label="row.label"
                  :used="row.used"
                  :limit="row.limit"
                  :hint="row.perPeriod ? 'في الفترة الحالية' : undefined"
                />
              </div>

              <template v-if="canManage && !restricted">
                <v-btn
                  v-if="subscription.cancelAtPeriodEnd"
                  block
                  variant="tonal"
                  color="primary"
                  class="mt-6"
                  :loading="busy"
                  @click="setCancel(false)"
                >
                  متابعة التجديد
                </v-btn>
                <v-btn
                  v-else
                  block
                  variant="text"
                  color="error"
                  class="mt-6"
                  @click="cancelOpen = true"
                >
                  إيقاف التجديد
                </v-btn>
              </template>
            </v-card-text>
            <v-card-text v-else>لا يوجد اشتراك لهذا المتجر. اختر باقة للبدء.</v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="7">
          <v-row dense>
            <v-col v-for="plan in overview.plans" :key="plan.id" cols="12" sm="4">
              <v-card
                class="h-100 d-flex flex-column"
                :variant="isCurrent(plan) ? 'outlined' : 'elevated'"
                :color="isCurrent(plan) ? 'primary' : undefined"
              >
                <v-card-text class="flex-grow-1">
                  <div class="text-subtitle-1 font-weight-bold text-high-emphasis">
                    {{ plan.nameAr }}
                  </div>
                  <div class="text-body-2 text-medium-emphasis mb-3 numeric">{{ price(plan) }}</div>
                  <div class="text-caption text-high-emphasis">
                    <div
                      v-for="metric in [
                        'USERS',
                        'PRODUCTS',
                        'CHANNELS',
                        'AI_MESSAGES',
                      ] as LimitMetric[]"
                      :key="metric"
                    >
                      <v-icon icon="mdi-check" size="14" color="success" />
                      {{ limitText(plan, metric)
                      }}<span v-if="metric === 'AI_MESSAGES'"> شهرياً</span>
                    </div>
                    <div v-for="feature in plan.features" :key="feature">
                      <v-icon icon="mdi-check" size="14" color="success" /> {{ feature }}
                    </div>
                  </div>
                </v-card-text>
                <v-card-actions class="px-4 pb-4">
                  <v-chip
                    v-if="isCurrent(plan)"
                    color="primary"
                    variant="tonal"
                    size="small"
                    class="w-100 justify-center"
                  >
                    باقتك الحالية
                  </v-chip>
                  <v-btn
                    v-else-if="canManage"
                    block
                    color="primary"
                    :variant="restricted ? 'flat' : 'tonal'"
                    @click="planTarget = plan"
                  >
                    {{ restricted ? 'اشترك' : 'انتقل لهذه الباقة' }}
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>
          </v-row>
          <div class="text-caption text-medium-emphasis mt-2">
            تغيير الباقة يسري فوراً، والسعر الجديد يُحتسب من الفاتورة القادمة. الدفع بالتحويل أو زين
            كاش أو FIB، ويُفعَّل بعد تأكيد فريق المنصة لاستلامه.
          </div>
        </v-col>
      </v-row>

      <v-card class="mt-4">
        <v-card-title class="text-subtitle-1 font-weight-bold">الفواتير</v-card-title>
        <v-table v-if="invoices.length" density="comfortable">
          <thead>
            <tr>
              <th>الرقم</th>
              <th>الفترة</th>
              <th>المبلغ</th>
              <th>الاستحقاق</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="invoice in invoices" :key="invoice.id">
              <td class="numeric" dir="ltr">{{ invoice.number }}</td>
              <td>{{ formatDate(invoice.periodStart) }} – {{ formatDate(invoice.periodEnd) }}</td>
              <td class="numeric">{{ formatCurrency(invoice.total, invoice.currency) }}</td>
              <td>
                {{
                  invoice.paidAt ? `دُفعت ${formatDate(invoice.paidAt)}` : formatDate(invoice.dueAt)
                }}
              </td>
              <td>
                <v-chip :color="INVOICE_STATUS_COLORS[invoice.status]" size="small" variant="tonal">
                  {{ INVOICE_STATUS_LABELS[invoice.status] }}
                </v-chip>
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-card-text v-else class="text-body-2 text-medium-emphasis">
          لا توجد فواتير بعد. تصدر أول فاتورة عند انتهاء الفترة التجريبية.
        </v-card-text>
      </v-card>

      <ConfirmDialog
        :model-value="Boolean(planTarget)"
        :title="restricted ? 'الاشتراك في الباقة' : 'تغيير الباقة'"
        :message="
          restricted
            ? `ستبدأ فترة جديدة بباقة ${planTarget?.nameAr} وتصدر فاتورتها الآن.`
            : `ستنتقل لباقة ${planTarget?.nameAr} فوراً، والسعر الجديد يبدأ من الفاتورة القادمة.`
        "
        :confirm-label="restricted ? 'اشترك' : 'تأكيد'"
        color="primary"
        :loading="busy"
        @update:model-value="planTarget = null"
        @confirm="changePlan"
      />

      <ConfirmDialog
        v-model="cancelOpen"
        title="إيقاف التجديد"
        :message="`يبقى الاشتراك فعّالاً حتى ${subscription ? formatDate(subscription.currentPeriodEnd) : ''}، ثم يتوقف المساعد الذكي وإضافة البيانات. يمكنك التراجع قبل ذلك.`"
        confirm-label="إيقاف التجديد"
        :loading="busy"
        @confirm="setCancel(true)"
      />
    </template>
  </div>
</template>
