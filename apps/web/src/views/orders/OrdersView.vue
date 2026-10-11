<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import EmptyState from '@/components/data/EmptyState.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import OrderFormDialog from './components/OrderFormDialog.vue';
import { useRealtimeEvent } from '@/composables/useRealtime';
import {
  ORDER_SOURCE_LABELS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
} from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { REALTIME_EVENT } from '@/services/realtime';
import { ordersService } from '@/services/orders.service';
import { useAuthStore } from '@/stores/auth.store';
import { ApiError } from '@/types/api';
import type {
  Order,
  OrderEvent,
  OrderSource,
  OrderStats,
  OrderStatus,
  PaymentStatus,
} from '@/types/orders';
import { formatCurrency, formatDateTime, formatNumber, formatRelative } from '@/utils/format';
import { applyOrderEvent } from '@/utils/orders';

type Tab = 'open' | 'all' | OrderStatus;

const auth = useAuthStore();
const router = useRouter();

const orders = ref<Order[]>([]);
const total = ref(0);
const stats = ref<OrderStats | null>(null);
const page = ref(1);
const limit = ref(10);
const search = ref('');
const tab = ref<Tab>('open');
const paymentFilter = ref<PaymentStatus | null>(null);
const sourceFilter = ref<OrderSource | null>(null);

const loading = ref(false);
const loadError = ref<ApiError | null>(null);
const formOpen = ref(false);

const canCreate = computed(() => auth.can(PERMISSIONS.ORDERS_CREATE));

const headers = [
  { title: 'الطلب', key: 'orderNumber', sortable: false, width: 120 },
  { title: 'الزبون', key: 'customerName', sortable: false },
  { title: 'الإجمالي', key: 'total', sortable: false, width: 150 },
  { title: 'الدفع', key: 'paymentStatus', sortable: false, width: 130 },
  { title: 'الحالة', key: 'status', sortable: false, width: 130 },
  { title: 'التاريخ', key: 'createdAt', sortable: false, width: 150 },
];

const tabs = computed(() => {
  const byStatus = stats.value?.byStatus;
  const count = (status: OrderStatus) => byStatus?.[status] ?? 0;

  return [
    { value: 'open' as Tab, title: 'المفتوحة', count: stats.value?.open ?? 0 },
    ...(['NEW', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as OrderStatus[]).map(
      (status) => ({ value: status as Tab, title: ORDER_STATUS_LABELS[status], count: count(status) }),
    ),
    { value: 'all' as Tab, title: 'الكل', count: stats.value?.total ?? 0 },
  ];
});

const paymentOptions = Object.entries(PAYMENT_STATUS_LABELS).map(([value, title]) => ({
  value,
  title,
}));

const sourceOptions = Object.entries(ORDER_SOURCE_LABELS)
  .filter(([value]) => value !== 'API')
  .map(([value, title]) => ({ value, title }));

const OPEN_STATUSES: OrderStatus[] = ['NEW', 'CONFIRMED', 'PREPARING', 'SHIPPED'];

/** Whether an order belongs in the list under the current tab and filters. */
function matchesView(order: Order): boolean {
  if (tab.value === 'open' && !OPEN_STATUSES.includes(order.status)) return false;
  if (tab.value !== 'open' && tab.value !== 'all' && order.status !== tab.value) return false;
  if (paymentFilter.value && order.paymentStatus !== paymentFilter.value) return false;
  if (sourceFilter.value && order.source !== sourceFilter.value) return false;
  // A search is a narrowed view; live rows are only added to an unsearched list.
  return !search.value;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;

  try {
    const [result, counters] = await Promise.all([
      ordersService.list({
        page: page.value,
        limit: limit.value,
        search: search.value || undefined,
        open: tab.value === 'open' || undefined,
        status: tab.value !== 'open' && tab.value !== 'all' ? tab.value : undefined,
        paymentStatus: paymentFilter.value ?? undefined,
        source: sourceFilter.value ?? undefined,
      }),
      ordersService.stats(),
    ]);
    orders.value = result.items;
    total.value = result.meta.total;
    stats.value = counters;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

let statsTimer: number | undefined;

/** Tab counters refresh once per burst of events, not once per event. */
function refreshStatsSoon(): void {
  window.clearTimeout(statsTimer);
  statsTimer = window.setTimeout(async () => {
    try {
      stats.value = await ordersService.stats();
    } catch {
      // Counters catch up on the next load.
    }
  }, 800);
}

useRealtimeEvent<OrderEvent>(REALTIME_EVENT.ORDER_UPDATED, (event) => {
  refreshStatsSoon();

  // Only the first page shows new arrivals; deeper pages would shift under the reader.
  const next = applyOrderEvent(orders.value, event, (order) =>
    page.value === 1 ? matchesView(order) : orders.value.some((row) => row.id === order.id) && matchesView(order),
  );
  if (!next) return;

  total.value += next.length - orders.value.length;
  orders.value = next.slice(0, limit.value);
});

let searchTimer: number | undefined;

watch(search, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    load();
  }, 350);
});

watch([tab, paymentFilter, sourceFilter], () => {
  page.value = 1;
  load();
});
watch([page, limit], load);

onMounted(load);

function onRowClick(_event: Event, row: { item: Order }): void {
  router.push({ name: 'order-detail', params: { id: row.item.id } });
}
</script>

<template>
  <div>
    <PageHeader title="الطلبات" subtitle="من كل القنوات ولوحة التحكم، من الإنشاء حتى التسليم">
      <template #actions>
        <v-btn v-if="canCreate" color="primary" prepend-icon="mdi-plus" @click="formOpen = true">
          طلب جديد
        </v-btn>
      </template>
    </PageHeader>

    <v-card>
      <v-tabs v-model="tab" color="primary" show-arrows density="comfortable">
        <v-tab v-for="item in tabs" :key="item.value" :value="item.value">
          {{ item.title }}
          <v-chip size="x-small" variant="tonal" class="ms-2 numeric">
            {{ formatNumber(item.count) }}
          </v-chip>
        </v-tab>
      </v-tabs>

      <v-divider />

      <div class="d-flex flex-wrap ga-3 pa-4">
        <v-text-field
          v-model="search"
          placeholder="رقم الطلب، اسم الزبون أو هاتفه"
          prepend-inner-icon="mdi-magnify"
          clearable
          style="min-width: 240px; max-width: 340px"
        />
        <v-select
          v-model="paymentFilter"
          :items="paymentOptions"
          label="الدفع"
          clearable
          style="max-width: 170px"
        />
        <v-select
          v-model="sourceFilter"
          :items="sourceOptions"
          label="المصدر"
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
        :items="orders"
        :items-length="total"
        :loading="loading"
        :items-per-page-options="[10, 25, 50]"
        item-value="id"
        hover
        @click:row="onRowClick"
      >
        <template #item.orderNumber="{ item }">
          <div class="d-flex align-center ga-2">
            <span class="font-weight-bold numeric">#{{ item.orderNumber }}</span>
            <v-icon
              v-if="item.source === 'AI'"
              icon="mdi-robot-outline"
              size="small"
              color="primary"
              :title="ORDER_SOURCE_LABELS.AI"
            />
          </div>
        </template>

        <template #item.customerName="{ item }">
          <div class="py-2">
            <div class="text-body-2 font-weight-medium">{{ item.customerName }}</div>
            <div class="text-caption text-medium-emphasis">
              <bdi dir="ltr">{{ item.customerPhone }}</bdi>
              <span v-if="item.deliveryCity"> · {{ item.deliveryCity }}</span>
            </div>
          </div>
        </template>

        <template #item.total="{ item }">
          <div class="d-flex flex-column">
            <span class="text-body-2 font-weight-medium numeric">
              {{ formatCurrency(item.total, item.currency) }}
            </span>
            <span class="text-caption text-medium-emphasis">
              {{ formatNumber(item.itemsCount) }} منتج
            </span>
          </div>
        </template>

        <template #item.paymentStatus="{ item }">
          <v-chip :color="PAYMENT_STATUS_COLORS[item.paymentStatus]" size="small" variant="tonal">
            {{ PAYMENT_STATUS_LABELS[item.paymentStatus] }}
          </v-chip>
        </template>

        <template #item.status="{ item }">
          <v-chip :color="ORDER_STATUS_COLORS[item.status]" size="small" variant="flat">
            {{ ORDER_STATUS_LABELS[item.status] }}
          </v-chip>
        </template>

        <template #item.createdAt="{ item }">
          <span class="text-body-2" :title="formatDateTime(item.createdAt)">
            {{ formatRelative(item.createdAt) }}
          </span>
        </template>

        <template #no-data>
          <EmptyState
            icon="mdi-cart-outline"
            title="لا توجد طلبات"
            description="تظهر هنا الطلبات التي ينشئها المساعد الذكي من المحادثات، أو التي تضيفها يدوياً."
            :action-label="canCreate ? 'طلب جديد' : undefined"
            @action="formOpen = true"
          />
        </template>
      </v-data-table-server>
    </v-card>

    <OrderFormDialog v-model="formOpen" />
  </div>
</template>
