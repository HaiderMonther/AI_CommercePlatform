<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import EmptyState from '@/components/data/EmptyState.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import StatCard from '@/components/data/StatCard.vue';
import { MOVEMENT_TYPE_COLORS, MOVEMENT_TYPE_LABELS } from '@/constants/labels';
import { inventoryService } from '@/services/catalog.service';
import { useAuthStore } from '@/stores/auth.store';
import { ApiError } from '@/types/api';
import { formatCurrency, formatDateTime, formatNumber } from '@/utils/format';
import type { InventoryMovement, InventorySummary, LowStockRow } from '@/types/users';

const auth = useAuthStore();

const summary = ref<InventorySummary | null>(null);
const lowStock = ref<LowStockRow[]>([]);
const movements = ref<InventoryMovement[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(25);
const typeFilter = ref<string | null>(null);

const loading = ref(false);
const loadError = ref<ApiError | null>(null);

const headers = [
  { title: 'المنتج', key: 'product', sortable: false },
  { title: 'الحركة', key: 'type', sortable: false, width: 140 },
  { title: 'الكمية', key: 'quantity', sortable: false, width: 160 },
  { title: 'السبب', key: 'reason', sortable: false },
  { title: 'المنفّذ', key: 'user', sortable: false, width: 140 },
  { title: 'التاريخ', key: 'createdAt', sortable: false, width: 210 },
];

const typeOptions = Object.entries(MOVEMENT_TYPE_LABELS).map(([value, title]) => ({ value, title }));

async function loadMovements(): Promise<void> {
  loading.value = true;
  loadError.value = null;

  try {
    const result = await inventoryService.movements({
      page: page.value,
      limit: limit.value,
      type: (typeFilter.value as InventoryMovement['type']) ?? undefined,
    });
    movements.value = result.items;
    total.value = result.meta.total;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

async function loadOverview(): Promise<void> {
  try {
    const [summaryResult, lowStockResult] = await Promise.all([
      inventoryService.summary(),
      inventoryService.lowStock(),
    ]);
    summary.value = summaryResult;
    lowStock.value = lowStockResult;
  } catch {
    // The ledger below is the primary content; the overview cards are supplementary.
  }
}

watch([page, limit, typeFilter], loadMovements);

onMounted(() => {
  loadMovements();
  loadOverview();
});
</script>

<template>
  <div>
    <PageHeader
      title="المخزون"
      subtitle="كل تغيّر في الكميات مسجَّل مع سببه ومنفّذه ووقته"
    />

    <v-row dense class="mb-2">
      <v-col cols="12" sm="6" md="3">
        <StatCard
          title="إجمالي القطع"
          :value="formatNumber(summary?.totalUnits ?? 0)"
          icon="mdi-cube-outline"
          :loading="!summary"
        />
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <StatCard
          title="المتاح للبيع"
          :value="formatNumber(summary?.availableUnits ?? 0)"
          icon="mdi-cart-check"
          color="success"
          :hint="summary?.reservedUnits ? `${formatNumber(summary.reservedUnits)} محجوز` : undefined"
          :loading="!summary"
        />
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <StatCard
          title="مخزون منخفض"
          :value="formatNumber(summary?.lowStockCount ?? 0)"
          icon="mdi-alert-outline"
          color="warning"
          :hint="summary?.outOfStockCount ? `${formatNumber(summary.outOfStockCount)} نفد` : undefined"
          :loading="!summary"
        />
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <StatCard
          title="قيمة المخزون"
          :value="formatCurrency(summary?.stockValue ?? 0, auth.currency)"
          icon="mdi-cash-multiple"
          color="info"
          hint="بسعر التكلفة"
          :loading="!summary"
        />
      </v-col>
    </v-row>

    <v-card v-if="lowStock.length" class="mb-4 pa-4">
      <div class="d-flex align-center ga-2 mb-3">
        <v-icon icon="mdi-alert-outline" color="warning" />
        <span class="text-subtitle-2 font-weight-bold">منتجات تحتاج إعادة طلب</span>
      </div>

      <div class="d-flex flex-wrap ga-2">
        <v-chip
          v-for="row in lowStock.slice(0, 12)"
          :key="row.id"
          :color="row.stock === 0 ? 'error' : 'warning'"
          variant="tonal"
          size="small"
        >
          {{ row.name }} — <span class="numeric ms-1">{{ row.stock }}</span>
        </v-chip>
        <v-chip v-if="lowStock.length > 12" size="small" variant="text">
          +<span class="numeric">{{ lowStock.length - 12 }}</span> غيرها
        </v-chip>
      </div>
    </v-card>

    <v-card>
      <div class="d-flex flex-wrap ga-3 pa-4">
        <v-select
          v-model="typeFilter"
          :items="typeOptions"
          label="نوع الحركة"
          clearable
          style="max-width: 220px"
        />
      </div>

      <v-divider />

      <ErrorState
        v-if="loadError"
        :message="loadError.message"
        :correlation-id="loadError.correlationId"
        @retry="loadMovements"
      />

      <v-data-table-server
        v-else
        v-model:page="page"
        v-model:items-per-page="limit"
        :headers="headers"
        :items="movements"
        :items-length="total"
        :loading="loading"
        :items-per-page-options="[25, 50, 100]"
        item-value="id"
      >
        <template #item.product="{ item }">
          <div class="py-1 min-w-0">
            <div class="text-body-2 text-truncate">{{ item.product?.name ?? '—' }}</div>
            <div class="text-caption text-medium-emphasis numeric">
              {{ item.variant?.sku ?? item.product?.sku }}
              <span v-if="item.variant"> · {{ item.variant.name }}</span>
            </div>
          </div>
        </template>

        <template #item.type="{ item }">
          <v-chip :color="MOVEMENT_TYPE_COLORS[item.type]" size="small" variant="tonal">
            {{ MOVEMENT_TYPE_LABELS[item.type] }}
          </v-chip>
        </template>

        <template #item.quantity="{ item }">
          <!-- Signed change plus the running balance, so the row reads like a ledger line. -->
          <span
            class="numeric font-weight-medium"
            :class="item.quantity >= 0 ? 'text-success' : 'text-error'"
          >
            {{ item.quantity > 0 ? '+' : '' }}{{ item.quantity }}
          </span>
          <span class="text-caption text-medium-emphasis ms-2 numeric">
            {{ item.quantityBefore }} → {{ item.quantityAfter }}
          </span>
        </template>

        <template #item.reason="{ item }">
          <span class="text-body-2">{{ item.reason ?? '—' }}</span>
        </template>

        <template #item.user="{ item }">
          <span class="text-body-2">{{ item.user?.fullName ?? 'النظام' }}</span>
        </template>

        <template #item.createdAt="{ item }">
          <!-- Arabic dates carry a separate AM/PM token that wraps onto its own line
               in a narrow cell, so the cell is kept on one line. -->
          <span class="text-body-2 text-no-wrap">{{ formatDateTime(item.createdAt) }}</span>
        </template>

        <template #no-data>
          <EmptyState
            icon="mdi-warehouse"
            title="لا توجد حركات مخزون"
            description="ستظهر هنا كل عمليات الإدخال والإخراج والجرد والبيع."
          />
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>

<style scoped>
.min-w-0 {
  min-width: 0;
}
</style>
