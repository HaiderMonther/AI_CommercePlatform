<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import ChannelBadges from '@/components/data/ChannelBadges.vue';
import ConfirmDialog from '@/components/data/ConfirmDialog.vue';
import EmptyState from '@/components/data/EmptyState.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import CustomerFormDialog from './components/CustomerFormDialog.vue';
import {
  CHANNEL_LABELS,
  CUSTOMER_STATUS_COLORS,
  CUSTOMER_STATUS_LABELS,
} from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { customersService, type CustomersQuery } from '@/services/crm.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type { ChannelType, Customer, CustomerStatus } from '@/types/crm';
import { formatCurrency, formatNumber, formatRelative, initialsOf } from '@/utils/format';

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();

const customers = ref<Customer[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(10);
const search = ref('');
const statusFilter = ref<CustomerStatus | null>(null);
const channelFilter = ref<ChannelType | null>(null);
const sortBy = ref<NonNullable<CustomersQuery['sortBy']>>('createdAt');

const loading = ref(false);
const loadError = ref<ApiError | null>(null);

const formOpen = ref(false);
const editing = ref<Customer | null>(null);
const deleteTarget = ref<Customer | null>(null);
const deleting = ref(false);

const canCreate = computed(() => auth.can(PERMISSIONS.CUSTOMERS_CREATE));
const canUpdate = computed(() => auth.can(PERMISSIONS.CUSTOMERS_UPDATE));
const canDelete = computed(() => auth.can(PERMISSIONS.CUSTOMERS_DELETE));

const headers = [
  { title: 'الزبون', key: 'name', sortable: false },
  { title: 'القنوات', key: 'channels', sortable: false, width: 110 },
  { title: 'المدينة', key: 'city', sortable: false, width: 120 },
  { title: 'الطلبات', key: 'totalOrders', sortable: false, width: 150 },
  { title: 'آخر تواصل', key: 'lastContactAt', sortable: false, width: 140 },
  { title: 'الحالة', key: 'status', sortable: false, width: 100 },
  { title: '', key: 'actions', sortable: false, align: 'end' as const, width: 60 },
];

const statusOptions = Object.entries(CUSTOMER_STATUS_LABELS)
  .filter(([value]) => value !== 'ARCHIVED')
  .map(([value, title]) => ({ value, title }));

const channelOptions = Object.entries(CHANNEL_LABELS).map(([value, title]) => ({ value, title }));

const sortOptions = [
  { value: 'createdAt', title: 'الأحدث إضافة' },
  { value: 'lastContactAt', title: 'آخر تواصل' },
  { value: 'totalSpent', title: 'الأعلى إنفاقاً' },
  { value: 'name', title: 'الاسم' },
];

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;

  try {
    const result = await customersService.list({
      page: page.value,
      limit: limit.value,
      search: search.value || undefined,
      status: statusFilter.value ?? undefined,
      channel: channelFilter.value ?? undefined,
      sortBy: sortBy.value,
      sortOrder: sortBy.value === 'name' ? 'asc' : 'desc',
    });
    customers.value = result.items;
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

watch([statusFilter, channelFilter, sortBy], () => {
  page.value = 1;
  load();
});
watch([page, limit], load);

onMounted(load);

function openCreate(): void {
  editing.value = null;
  formOpen.value = true;
}

function openEdit(customer: Customer): void {
  editing.value = customer;
  formOpen.value = true;
}

function openDetail(customer: Customer): void {
  router.push({ name: 'customer-detail', params: { id: customer.id } });
}

function onRowClick(_event: Event, row: { item: Customer }): void {
  openDetail(row.item);
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;

  deleting.value = true;
  try {
    await customersService.remove(deleteTarget.value.id);
    ui.success('تم حذف الزبون');
    deleteTarget.value = null;
    await load();
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر حذف الزبون');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader title="الزبائن" subtitle="كل من تواصل مع المتجر، بهوية واحدة عبر كل القنوات">
      <template #actions>
        <v-btn v-if="canCreate" color="primary" prepend-icon="mdi-plus" @click="openCreate">
          إضافة زبون
        </v-btn>
      </template>
    </PageHeader>

    <v-card>
      <div class="d-flex flex-wrap ga-3 pa-4">
        <v-text-field
          v-model="search"
          placeholder="ابحث بالاسم أو الهاتف أو البريد"
          prepend-inner-icon="mdi-magnify"
          clearable
          style="min-width: 240px; max-width: 340px"
        />
        <v-select
          v-model="channelFilter"
          :items="channelOptions"
          label="القناة"
          clearable
          style="max-width: 160px"
        />
        <v-select
          v-model="statusFilter"
          :items="statusOptions"
          label="الحالة"
          clearable
          style="max-width: 150px"
        />
        <v-select v-model="sortBy" :items="sortOptions" label="الترتيب" style="max-width: 180px" />
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
        :items="customers"
        :items-length="total"
        :loading="loading"
        :items-per-page-options="[10, 25, 50]"
        item-value="id"
        hover
        @click:row="onRowClick"
      >
        <template #item.name="{ item }">
          <div class="d-flex align-center ga-3 py-2">
            <v-avatar color="primary" variant="tonal" size="38">
              <span class="text-caption font-weight-bold">{{ initialsOf(item.name) }}</span>
            </v-avatar>
            <div class="min-w-0">
              <div class="text-body-2 font-weight-medium text-truncate">{{ item.name }}</div>
              <div class="text-caption text-medium-emphasis numeric" dir="ltr">
                {{ item.phone ?? item.email ?? '—' }}
              </div>
            </div>
          </div>
        </template>

        <template #item.channels="{ item }">
          <ChannelBadges :channels="item.channels" />
        </template>

        <template #item.city="{ item }">
          <span :class="{ 'text-medium-emphasis': !item.city }">{{ item.city ?? '—' }}</span>
        </template>

        <template #item.totalOrders="{ item }">
          <div class="d-flex flex-column">
            <span class="text-body-2 numeric">{{ formatNumber(item.totalOrders) }} طلب</span>
            <span class="text-caption text-medium-emphasis">
              {{ formatCurrency(item.totalSpent, auth.currency) }}
            </span>
          </div>
        </template>

        <template #item.lastContactAt="{ item }">
          <span class="text-body-2">{{ formatRelative(item.lastContactAt) }}</span>
        </template>

        <template #item.status="{ item }">
          <v-chip :color="CUSTOMER_STATUS_COLORS[item.status]" size="small" variant="tonal">
            {{ CUSTOMER_STATUS_LABELS[item.status] }}
          </v-chip>
        </template>

        <template #item.actions="{ item }">
          <v-menu v-if="canUpdate || canDelete" location="bottom end">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-dots-vertical"
                variant="text"
                size="small"
                @click.stop
              />
            </template>
            <v-list density="compact">
              <v-list-item
                prepend-icon="mdi-account-details-outline"
                title="الملف الكامل"
                @click="openDetail(item)"
              />
              <v-list-item
                v-if="canUpdate"
                prepend-icon="mdi-pencil-outline"
                title="تعديل"
                @click="openEdit(item)"
              />
              <v-list-item
                v-if="canDelete"
                prepend-icon="mdi-delete-outline"
                title="حذف"
                base-color="error"
                @click="deleteTarget = item"
              />
            </v-list>
          </v-menu>
        </template>

        <template #no-data>
          <EmptyState
            icon="mdi-account-heart-outline"
            title="لا يوجد زبائن"
            description="يُضاف الزبون تلقائياً عند أول رسالة منه على أي قناة، أو يمكنك إضافته يدوياً."
            :action-label="canCreate ? 'إضافة زبون' : undefined"
            @action="openCreate"
          />
        </template>
      </v-data-table-server>
    </v-card>

    <CustomerFormDialog v-model="formOpen" :customer="editing" @saved="load" />

    <ConfirmDialog
      :model-value="Boolean(deleteTarget)"
      title="حذف الزبون"
      :message="`سيتم حذف «${deleteTarget?.name ?? ''}». تبقى طلباته ومحادثاته في السجل، ويصبح رقمه متاحاً لزبون جديد.`"
      confirm-label="حذف"
      :loading="deleting"
      @update:model-value="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.min-w-0 {
  min-width: 0;
}
</style>
