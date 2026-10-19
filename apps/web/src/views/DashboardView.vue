<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import BarList from '@/components/charts/BarList.vue';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import StatCard from '@/components/data/StatCard.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useRealtimeEvent } from '@/composables/useRealtime';
import { ORDER_STATUS_COLORS, ORDER_STATUS_ICONS, ORDER_STATUS_LABELS } from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { REALTIME_EVENT } from '@/services/realtime';
import { dashboardService } from '@/services/reports.service';
import { useAuthStore } from '@/stores/auth.store';
import type { OrderStatus } from '@/types/orders';
import type { DashboardSummary } from '@/types/reports';
import { compactNumber, shortDay } from '@/utils/charts';
import { formatCurrency, formatNumber, formatRelative } from '@/utils/format';

const auth = useAuthStore();
const router = useRouter();

const {
  data: summary,
  loading,
  error,
  execute,
} = useAsyncData<DashboardSummary | null>(() => dashboardService.summary(), null);

onMounted(execute);

// New and changed orders move the numbers; refresh at most every few seconds.
let refreshTimer: number | undefined;
useRealtimeEvent(REALTIME_EVENT.ORDER_UPDATED, () => {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(execute, 3000);
});

const trendMetric = ref<'value' | 'orders'>('value');
const money = (value: number) => formatCurrency(value, auth.currency);

const trendPoints = computed(() =>
  (summary.value?.sales?.trend ?? []).map((day) => ({
    key: day.day,
    label: shortDay(day.day),
    value: trendMetric.value === 'value' ? day.value : day.orders,
    detail: trendMetric.value === 'value' ? `${formatNumber(day.orders)} طلب` : money(day.value),
  })),
);

const openOrders = computed(() => {
  const open = summary.value?.sales?.open;
  if (!open) return [];
  return (Object.keys(open) as OrderStatus[]).map((status) => ({
    status,
    count: open[status],
  }));
});

const lowStockItems = computed(() =>
  (summary.value?.inventory?.lowStock ?? []).map((product) => ({
    key: product.id,
    label: product.name,
    value: product.stock,
    detail: `الحد ${product.lowStockThreshold}`,
  })),
);

const percent = (value: number | null | undefined) => (value == null ? '—' : `${value}%`);

const isEmpty = computed(
  () =>
    summary.value &&
    !summary.value.sales &&
    !summary.value.conversations &&
    !summary.value.inventory &&
    !summary.value.customers,
);
</script>

<template>
  <div>
    <PageHeader
      :title="`أهلاً ${auth.user?.fullName ?? ''}`"
      :subtitle="auth.company?.name ?? 'لوحة التحكم'"
    >
      <template #actions>
        <v-btn
          v-if="auth.can(PERMISSIONS.REPORTS_READ)"
          variant="tonal"
          prepend-icon="mdi-chart-box-outline"
          :to="{ name: 'reports' }"
        >
          التقارير
        </v-btn>
      </template>
    </PageHeader>

    <ErrorState
      v-if="error"
      :message="error.message"
      :correlation-id="error.correlationId"
      @retry="execute"
    />

    <v-skeleton-loader v-else-if="loading && !summary" type="card, card, card" />

    <template v-else-if="summary">
      <v-alert v-if="isEmpty" type="info" variant="tonal">
        لا توجد أقسام متاحة لدورك في لوحة التحكم. تواصل مع مدير المتجر لمنحك الصلاحيات.
      </v-alert>

      <!-- Sales -->
      <template v-if="summary.sales">
        <v-card class="pa-5 mb-4">
          <div class="d-flex flex-wrap align-end ga-6">
            <div>
              <div class="text-body-2 text-medium-emphasis">
                مبيعات آخر {{ summary.sales.period.days }} يوماً
              </div>
              <div class="hero numeric">{{ money(summary.sales.period.value) }}</div>
              <div class="d-flex align-center ga-1 text-body-2">
                <template v-if="summary.sales.period.change.value !== null">
                  <v-icon
                    :icon="
                      summary.sales.period.change.value >= 0
                        ? 'mdi-arrow-top-right'
                        : 'mdi-arrow-bottom-right'
                    "
                    :color="summary.sales.period.change.value >= 0 ? 'success' : 'error'"
                    size="16"
                  />
                  <span
                    :class="summary.sales.period.change.value >= 0 ? 'text-success' : 'text-error'"
                    class="font-weight-medium numeric"
                    dir="ltr"
                  >
                    {{ summary.sales.period.change.value > 0 ? '+' : ''
                    }}{{ summary.sales.period.change.value }}%
                  </span>
                  <span class="text-medium-emphasis">عن الفترة السابقة</span>
                </template>
              </div>
            </div>
            <v-spacer />
            <v-btn-toggle
              v-model="trendMetric"
              mandatory
              density="compact"
              variant="outlined"
              divided
            >
              <v-btn value="value" size="small">القيمة</v-btn>
              <v-btn value="orders" size="small">عدد الطلبات</v-btn>
            </v-btn-toggle>
          </div>

          <div class="text-caption text-medium-emphasis mt-4 mb-1">
            {{ trendMetric === 'value' ? 'قيمة الطلبات' : 'عدد الطلبات' }} يومياً، آخر 14 يوماً
          </div>
          <ColumnChart
            :points="trendPoints"
            :title="trendMetric === 'value' ? 'قيمة الطلبات اليومية' : 'عدد الطلبات اليومي'"
            :format="trendMetric === 'value' ? money : (v) => `${formatNumber(v)} طلب`"
          />
        </v-card>

        <v-row dense class="mb-2">
          <v-col cols="12" sm="6" lg="3">
            <StatCard
              title="طلبات اليوم"
              :value="formatNumber(summary.sales.today.orders)"
              :hint="money(summary.sales.today.value)"
              icon="mdi-cart-outline"
            />
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <StatCard
              :title="`طلبات آخر ${summary.sales.period.days} يوماً`"
              :value="formatNumber(summary.sales.period.orders)"
              :delta="summary.sales.period.change.orders"
              delta-label="عن الفترة السابقة"
              icon="mdi-receipt-text-outline"
            />
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <StatCard
              title="متوسط قيمة الطلب"
              :value="money(summary.sales.period.averageOrderValue)"
              icon="mdi-scale-balance"
              color="secondary"
            />
          </v-col>
          <v-col cols="12" sm="6" lg="3">
            <StatCard
              title="الإيراد المُسلَّم"
              :value="money(summary.sales.period.deliveredRevenue)"
              hint="قيمة الطلبات التي وصلت للزبائن"
              icon="mdi-cash-check"
              color="success"
            />
          </v-col>
        </v-row>
      </template>

      <!-- Conversations -->
      <v-row v-if="summary.conversations" dense class="mb-2">
        <v-col cols="6" lg="3">
          <StatCard
            title="محادثات مفتوحة"
            :value="formatNumber(summary.conversations.open)"
            icon="mdi-forum-outline"
          />
        </v-col>
        <v-col cols="6" lg="3">
          <StatCard
            title="بانتظار موظف"
            :value="formatNumber(summary.conversations.waitingForStaff)"
            hint="حُوّلت لموظف ولم يتسلّمها أحد"
            icon="mdi-account-clock-outline"
            :color="summary.conversations.waitingForStaff ? 'warning' : 'secondary'"
          />
        </v-col>
        <v-col cols="6" lg="3">
          <StatCard
            title="غير مقروءة"
            :value="formatNumber(summary.conversations.unread)"
            icon="mdi-email-alert-outline"
            color="info"
          />
        </v-col>
        <v-col cols="6" lg="3">
          <StatCard
            title="مسندة إليّ"
            :value="formatNumber(summary.conversations.assignedToMe)"
            icon="mdi-account-check-outline"
            color="secondary"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col v-if="summary.sales" cols="12" md="7">
          <v-card class="h-100">
            <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
              آخر الطلبات
              <v-spacer />
              <v-btn size="small" variant="text" :to="{ name: 'orders' }">الكل</v-btn>
            </v-card-title>

            <div class="d-flex flex-wrap ga-2 px-4 pb-2">
              <v-chip
                v-for="item in openOrders"
                :key="item.status"
                size="small"
                variant="tonal"
                :color="ORDER_STATUS_COLORS[item.status]"
                :prepend-icon="ORDER_STATUS_ICONS[item.status]"
                @click="router.push({ name: 'orders' })"
              >
                {{ ORDER_STATUS_LABELS[item.status] }}
                <span class="ms-1 font-weight-bold numeric">{{ item.count }}</span>
              </v-chip>
            </div>

            <v-list v-if="summary.sales.recent.length" lines="two">
              <v-list-item
                v-for="order in summary.sales.recent"
                :key="order.id"
                :to="{ name: 'order-detail', params: { id: order.id } }"
              >
                <v-list-item-title>
                  <span class="numeric font-weight-bold">#{{ order.orderNumber }}</span>
                  · {{ order.customerName }}
                  <v-icon
                    v-if="order.source === 'AI'"
                    icon="mdi-robot-outline"
                    size="14"
                    color="primary"
                  />
                </v-list-item-title>
                <v-list-item-subtitle>{{ formatRelative(order.createdAt) }}</v-list-item-subtitle>
                <template #append>
                  <div class="d-flex flex-column align-end ga-1">
                    <span class="text-body-2 numeric">{{
                      formatCurrency(order.total, order.currency)
                    }}</span>
                    <v-chip
                      :color="ORDER_STATUS_COLORS[order.status]"
                      size="x-small"
                      variant="flat"
                    >
                      {{ ORDER_STATUS_LABELS[order.status] }}
                    </v-chip>
                  </div>
                </template>
              </v-list-item>
            </v-list>
            <v-card-text v-else class="text-body-2 text-medium-emphasis"
              >
لا توجد طلبات بعد.
</v-card-text
            >
          </v-card>
        </v-col>

        <v-col cols="12" :md="summary.sales ? 5 : 12">
          <v-card v-if="summary.ai" class="mb-4">
            <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
              <v-icon icon="mdi-robot-outline" class="me-2" size="20" />
              المساعد الذكي · آخر 30 يوماً
            </v-card-title>
            <v-card-text>
              <v-alert
                v-if="!summary.ai.configured"
                type="warning"
                variant="tonal"
                density="compact"
                class="mb-3"
              >
                المساعد غير مفعّل على الخادم.
              </v-alert>
              <v-row dense>
                <v-col cols="6">
                  <div class="text-caption text-medium-emphasis">محادثات بلا تدخل موظف</div>
                  <div class="text-h6 font-weight-bold numeric">
                    {{ percent(summary.ai.automationRate) }}
                  </div>
                </v-col>
                <v-col cols="6">
                  <div class="text-caption text-medium-emphasis">طلبات أنشأها</div>
                  <div class="text-h6 font-weight-bold numeric">
                    {{ formatNumber(summary.ai.orders) }}
                  </div>
                  <div class="text-caption text-medium-emphasis numeric">
                    {{ money(summary.ai.ordersValue) }}
                  </div>
                </v-col>
                <v-col cols="6">
                  <div class="text-caption text-medium-emphasis">ردود</div>
                  <div class="text-body-1 font-weight-medium numeric">
                    {{ formatNumber(summary.ai.runs) }}
                  </div>
                </v-col>
                <v-col cols="6">
                  <div class="text-caption text-medium-emphasis">تحويلات لموظف</div>
                  <div class="text-body-1 font-weight-medium numeric">
                    {{ formatNumber(summary.ai.handovers) }}
                  </div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>

          <v-card v-if="summary.inventory" class="mb-4">
            <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
              يحتاج إعادة تخزين
              <v-spacer />
              <v-chip
                v-if="summary.inventory.outOfStockCount"
                size="small"
                color="error"
                variant="tonal"
                prepend-icon="mdi-alert-circle-outline"
              >
                نفد {{ summary.inventory.outOfStockCount }}
              </v-chip>
            </v-card-title>
            <v-card-text>
              <BarList
                :items="lowStockItems"
                :format="(v) => `${compactNumber(v)} قطعة`"
                empty-text="كل المنتجات فوق حد إعادة الطلب"
              />
              <v-btn
                v-if="lowStockItems.length"
                block
                variant="text"
                class="mt-3"
                :to="{ name: 'inventory' }"
              >
                إدارة المخزون
              </v-btn>
            </v-card-text>
          </v-card>

          <v-card v-if="summary.customers">
            <v-card-text class="d-flex align-center ga-4">
              <v-avatar color="primary" variant="tonal" rounded="lg" size="46">
                <v-icon icon="mdi-account-heart-outline" />
              </v-avatar>
              <div>
                <div class="text-caption text-medium-emphasis">الزبائن</div>
                <div class="text-h6 font-weight-bold numeric">
                  {{ formatNumber(summary.customers.total) }}
                </div>
              </div>
              <v-spacer />
              <div class="text-end">
                <div class="text-caption text-medium-emphasis">جدد خلال 30 يوماً</div>
                <div class="text-body-1 font-weight-medium numeric">
                  +{{ formatNumber(summary.customers.newInPeriod) }}
                </div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </div>
</template>

<style scoped>
.hero {
  font-size: 2.75rem;
  font-weight: 700;
  line-height: 1.2;
}
</style>
