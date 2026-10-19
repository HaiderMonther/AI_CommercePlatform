<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BarList from '@/components/charts/BarList.vue';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import StatCard from '@/components/data/StatCard.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import {
  CHANNEL_ICONS,
  CHANNEL_LABELS,
  ORDER_SOURCE_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { reportsService } from '@/services/reports.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type {
  AiReport,
  Breakdown,
  ConversationsReport,
  ProductsReport,
  SalesReport,
} from '@/types/reports';
import { compactNumber, shortDay } from '@/utils/charts';
import { formatCurrency, formatNumber } from '@/utils/format';

type Tab = 'sales' | 'products' | 'conversations' | 'ai';

const auth = useAuthStore();
const ui = useUiStore();

const tab = ref<Tab>('sales');

// --- Period ---------------------------------------------------------------------------

// Presets are counted in Iraq's calendar; the API cuts days in the company's own timezone.

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Baghdad',
}).format(new Date());
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const presets = [
  { value: '7', title: 'آخر 7 أيام', from: () => shift(today, -6) },
  { value: '30', title: 'آخر 30 يوماً', from: () => shift(today, -29) },
  { value: '90', title: 'آخر 90 يوماً', from: () => shift(today, -89) },
  { value: 'month', title: 'هذا الشهر', from: () => `${today.slice(0, 8)}01` },
  { value: 'custom', title: 'فترة مخصصة', from: () => from.value },
];

const preset = ref('30');
const from = ref(shift(today, -29));
const to = ref(today);

watch(preset, (value) => {
  if (value === 'custom') return;
  from.value = presets.find((item) => item.value === value)!.from();
  to.value = today;
});

const range = computed(() => ({ from: from.value, to: to.value }));

// --- Data -----------------------------------------------------------------------------

const sales = ref<SalesReport | null>(null);
const products = ref<ProductsReport | null>(null);
const conversations = ref<ConversationsReport | null>(null);
const ai = ref<AiReport | null>(null);
const loading = ref(false);
const loadError = ref<ApiError | null>(null);
const exporting = ref(false);

async function load(): Promise<void> {
  if (!from.value || !to.value) return;
  loading.value = true;
  loadError.value = null;

  try {
    switch (tab.value) {
      case 'sales':
        sales.value = await reportsService.sales(range.value);
        break;
      case 'products':
        products.value = await reportsService.products(range.value);
        break;
      case 'conversations':
        conversations.value = await reportsService.conversations(range.value);
        break;
      case 'ai':
        ai.value = await reportsService.ai(range.value);
        break;
    }
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

watch([tab, range], load, { immediate: true });

async function exportOrders(): Promise<void> {
  exporting.value = true;
  try {
    await reportsService.exportOrders(range.value);
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذّر التصدير');
  } finally {
    exporting.value = false;
  }
}

// --- View helpers ---------------------------------------------------------------------

const money = (value: number) => formatCurrency(value, auth.currency);
const count = (value: number) => formatNumber(value);
const percent = (value: number | null) => (value == null ? '—' : `${value}%`);

const toBars = (rows: Breakdown[], labels: Record<string, string>, unknown = 'غير محدد') =>
  rows.map((row) => ({
    key: row.key ?? 'none',
    label: row.key ? (labels[row.key] ?? row.key) : unknown,
    value: row.value,
    detail: `${formatNumber(row.count)} طلب`,
  }));

const salesValuePoints = computed(() =>
  (sales.value?.series ?? []).map((day) => ({
    key: day.day,
    label: shortDay(day.day),
    value: day.value,
    detail: `${formatNumber(day.orders)} طلب`,
  })),
);
const salesCountPoints = computed(() =>
  (sales.value?.series ?? []).map((day) => ({
    key: day.day,
    label: shortDay(day.day),
    value: day.orders,
    detail: money(day.value),
  })),
);
const messagePoints = computed(() =>
  (conversations.value?.series ?? []).map((day) => ({
    key: day.day,
    label: shortDay(day.day),
    value: day.customerMessages,
    detail: `${formatNumber(day.replies)} رد`,
  })),
);
</script>

<template>
  <div>
    <PageHeader title="التقارير" subtitle="المبيعات والمنتجات والمحادثات وأداء المساعد الذكي">
      <template #actions>
        <v-btn
          v-if="auth.can(PERMISSIONS.ORDERS_READ)"
          variant="tonal"
          prepend-icon="mdi-file-delimited-outline"
          :loading="exporting"
          @click="exportOrders"
        >
          تصدير الطلبات (Excel)
        </v-btn>
      </template>
    </PageHeader>

    <v-card class="mb-4">
      <div class="d-flex flex-wrap align-center ga-3 pa-4">
        <v-select
          v-model="preset"
          :items="presets"
          label="الفترة"
          hide-details
          style="max-width: 200px"
        />
        <template v-if="preset === 'custom'">
          <v-text-field
            v-model="from"
            type="date"
            label="من"
            hide-details
            style="max-width: 180px"
          />
          <v-text-field
            v-model="to"
            type="date"
            label="إلى"
            hide-details
            style="max-width: 180px"
          />
        </template>
        <span v-else class="text-body-2 text-medium-emphasis numeric" dir="ltr"
          >{{ from }} → {{ to }}</span
        >
      </div>
      <v-divider />
      <v-tabs v-model="tab" color="primary" show-arrows>
        <v-tab value="sales" prepend-icon="mdi-cash-multiple">المبيعات</v-tab>
        <v-tab value="products" prepend-icon="mdi-package-variant-closed">المنتجات</v-tab>
        <v-tab value="conversations" prepend-icon="mdi-forum-outline">المحادثات</v-tab>
        <v-tab value="ai" prepend-icon="mdi-robot-outline">المساعد الذكي</v-tab>
      </v-tabs>
    </v-card>

    <ErrorState
      v-if="loadError"
      :message="loadError.message"
      :correlation-id="loadError.correlationId"
      @retry="load"
    />

    <v-progress-linear v-else-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- Sales -->
    <template v-if="tab === 'sales' && sales && !loadError">
      <v-row dense class="mb-2">
        <v-col cols="12" sm="6" lg="3">
          <StatCard
            title="قيمة الطلبات"
            :value="money(sales.totals.value)"
            :delta="sales.totals.change.value"
            delta-label="عن الفترة السابقة"
            icon="mdi-cash-multiple"
          />
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <StatCard
            title="عدد الطلبات"
            :value="count(sales.totals.orders)"
            :delta="sales.totals.change.orders"
            delta-label="عن الفترة السابقة"
            icon="mdi-receipt-text-outline"
          />
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <StatCard
            title="الإيراد المُسلَّم"
            :value="money(sales.totals.deliveredRevenue)"
            :hint="`${count(sales.totals.deliveredOrders)} طلب وصل · المستلم ${money(sales.totals.collected)}`"
            icon="mdi-cash-check"
            color="success"
          />
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <StatCard
            title="متوسط الطلب"
            :value="money(sales.totals.averageOrderValue)"
            :hint="`${count(sales.totals.customers)} زبون · ${count(sales.totals.cancelled)} ملغى`"
            icon="mdi-scale-balance"
            color="secondary"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" lg="6">
          <v-card class="pa-4">
            <div class="text-subtitle-1 font-weight-bold mb-2">قيمة الطلبات يومياً</div>
            <ColumnChart :points="salesValuePoints" title="قيمة الطلبات يومياً" :format="money" />
          </v-card>
        </v-col>
        <v-col cols="12" lg="6">
          <v-card class="pa-4">
            <div class="text-subtitle-1 font-weight-bold mb-2">عدد الطلبات يومياً</div>
            <ColumnChart
              :points="salesCountPoints"
              title="عدد الطلبات يومياً"
              :format="(v) => `${count(v)} طلب`"
            />
          </v-card>
        </v-col>

        <v-col cols="12" md="6" lg="3">
          <v-card class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-3">حسب المصدر</div>
            <BarList
              :items="toBars(sales.bySource, ORDER_SOURCE_LABELS)"
              :format="(v) => compactNumber(v)"
            />
          </v-card>
        </v-col>
        <v-col cols="12" md="6" lg="3">
          <v-card class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-3">حسب الحالة</div>
            <BarList
              :items="toBars(sales.byStatus, ORDER_STATUS_LABELS)"
              :format="(v) => compactNumber(v)"
            />
          </v-card>
        </v-col>
        <v-col cols="12" md="6" lg="3">
          <v-card class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-3">طرق الدفع</div>
            <BarList
              :items="toBars(sales.byPaymentMethod, PAYMENT_METHOD_LABELS)"
              :format="(v) => compactNumber(v)"
            />
          </v-card>
        </v-col>
        <v-col cols="12" md="6" lg="3">
          <v-card class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-3">أكثر المدن طلباً</div>
            <BarList
              :items="toBars(sales.topCities, {}, 'بلا مدينة')"
              :format="(v) => compactNumber(v)"
            />
          </v-card>
        </v-col>
      </v-row>
      <div class="text-caption text-medium-emphasis mt-2">
        المبالغ بالدينار وتشمل كل الطلبات عدا الملغاة. الإيراد المُسلَّم يُحسب بتاريخ التسليم.
      </div>
    </template>

    <!-- Products -->
    <template v-if="tab === 'products' && products && !loadError">
      <v-row dense class="mb-2">
        <v-col cols="12" sm="4">
          <StatCard
            title="منتجات بيعت"
            :value="count(products.totals.products)"
            icon="mdi-package-variant-closed"
          />
        </v-col>
        <v-col cols="12" sm="4">
          <StatCard
            title="القطع المباعة"
            :value="count(products.totals.quantity)"
            icon="mdi-counter"
            color="secondary"
          />
        </v-col>
        <v-col cols="12" sm="4">
          <StatCard
            title="إيراد المنتجات"
            :value="money(products.totals.revenue)"
            hint="قبل خصم الطلب وأجور التوصيل"
            icon="mdi-cash-multiple"
            color="success"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-card class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-3">الأعلى إيراداً</div>
            <BarList
              :items="
                products.byRevenue.map((p) => ({
                  key: p.productId ?? p.name,
                  label: p.deleted ? `${p.name} (محذوف)` : p.name,
                  value: p.revenue,
                  detail: `${count(p.quantity)} قطعة`,
                }))
              "
              :format="money"
            />
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-3">الأكثر مبيعاً بالكمية</div>
            <BarList
              :items="
                products.byQuantity.map((p) => ({
                  key: p.productId ?? p.name,
                  label: p.deleted ? `${p.name} (محذوف)` : p.name,
                  value: p.quantity,
                  detail: p.stock === null ? undefined : `المخزون ${p.stock}`,
                }))
              "
              :format="(v) => `${count(v)} قطعة`"
            />
          </v-card>
        </v-col>
      </v-row>
    </template>

    <!-- Conversations -->
    <template v-if="tab === 'conversations' && conversations && !loadError">
      <v-row dense class="mb-2">
        <v-col cols="6" lg="3">
          <StatCard
            title="محادثات جديدة"
            :value="count(conversations.totals.conversations)"
            icon="mdi-forum-outline"
          />
        </v-col>
        <v-col cols="6" lg="3">
          <StatCard
            title="رسائل الزبائن"
            :value="count(conversations.totals.customerMessages)"
            icon="mdi-message-text-outline"
            color="secondary"
          />
        </v-col>
        <v-col cols="6" lg="3">
          <StatCard
            title="ردود المساعد / الموظفين"
            :value="`${count(conversations.totals.aiReplies)} / ${count(conversations.totals.agentReplies)}`"
            icon="mdi-reply-outline"
            color="info"
          />
        </v-col>
        <v-col cols="6" lg="3">
          <StatCard
            title="تحويلات لموظف"
            :value="count(conversations.totals.handovers)"
            icon="mdi-account-switch-outline"
            color="warning"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" lg="8">
          <v-card class="pa-4">
            <div class="text-subtitle-1 font-weight-bold mb-2">رسائل الزبائن يومياً</div>
            <ColumnChart
              :points="messagePoints"
              title="رسائل الزبائن يومياً"
              :format="(v) => `${count(v)} رسالة`"
            />
          </v-card>
        </v-col>
        <v-col cols="12" lg="4">
          <v-card class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-3">المحادثات حسب القناة</div>
            <BarList
              :items="
                conversations.byChannel.map((c) => ({
                  key: c.key,
                  label: CHANNEL_LABELS[c.key],
                  icon: CHANNEL_ICONS[c.key],
                  value: c.count,
                }))
              "
              :format="(v) => `${count(v)} محادثة`"
            />
          </v-card>
        </v-col>
      </v-row>
    </template>

    <!-- AI -->
    <template v-if="tab === 'ai' && ai && !loadError">
      <v-row dense class="mb-2">
        <v-col cols="12" sm="6" lg="3">
          <StatCard
            title="محادثات بلا تدخل موظف"
            :value="percent(ai.totals.automationRate)"
            :hint="`من ${count(ai.totals.conversations)} محادثة جديدة`"
            icon="mdi-robot-happy-outline"
          />
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <StatCard
            title="طلبات أنشأها المساعد"
            :value="count(ai.totals.orders)"
            :hint="money(ai.totals.ordersValue)"
            icon="mdi-cart-check"
            color="success"
          />
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <StatCard
            title="ردود المساعد"
            :value="count(ai.totals.runs)"
            :hint="`نجاح ${percent(ai.totals.successRate)} · ${count(ai.totals.handovers)} تحويل`"
            icon="mdi-reply-all-outline"
            color="secondary"
          />
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <StatCard
            title="متوسط زمن الرد"
            :value="`${(ai.totals.averageLatencyMs / 1000).toFixed(1)} ث`"
            icon="mdi-timer-outline"
            color="info"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-card class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-1">الاستهلاك</div>
            <div class="text-caption text-medium-emphasis mb-3">
              الرموز (tokens) المرسلة للنموذج والمولّدة منه
            </div>
            <BarList
              :items="[
                {
                  key: 'prompt',
                  label: 'المدخلات (تشمل المخزّن مؤقتاً)',
                  value: ai.totals.promptTokens,
                },
                { key: 'completion', label: 'المخرجات', value: ai.totals.completionTokens },
              ]"
              :format="(v) => compactNumber(v)"
            />
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card class="pa-4 h-100">
            <div class="text-subtitle-1 font-weight-bold mb-3">حسب النموذج</div>
            <BarList
              :items="
                ai.byModel.map((m) => ({
                  key: m.key,
                  label: m.key,
                  value: m.runs,
                  detail: `${compactNumber(m.tokens)} رمز`,
                }))
              "
              :format="(v) => `${count(v)} رد`"
            />
          </v-card>
        </v-col>
      </v-row>
    </template>
  </div>
</template>
