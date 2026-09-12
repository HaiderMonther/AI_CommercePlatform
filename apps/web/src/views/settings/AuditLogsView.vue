<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import EmptyState from '@/components/data/EmptyState.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@/constants/labels';
import { auditService } from '@/services/company.service';
import { ApiError } from '@/types/api';
import { formatDateTime } from '@/utils/format';
import type { AuditLog } from '@/types/users';

const logs = ref<AuditLog[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(25);
const entityFilter = ref<string | null>(null);

const loading = ref(false);
const loadError = ref<ApiError | null>(null);

const headers = [
  { title: 'العملية', key: 'action', sortable: false },
  { title: 'العنصر', key: 'entity', sortable: false, width: 160 },
  { title: 'المستخدم', key: 'user', sortable: false },
  { title: 'التاريخ', key: 'createdAt', sortable: false, width: 200 },
];

const entityOptions = Object.entries(AUDIT_ENTITY_LABELS).map(([value, title]) => ({ value, title }));

/** Destructive actions are tinted so a scan of the list surfaces them first. */
const ACTION_COLORS: Record<string, string> = {
  create: 'success',
  update: 'info',
  delete: 'error',
  permissions_changed: 'warning',
  'auth.login_failed': 'error',
  'auth.token_reuse_detected': 'error',
};

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;

  try {
    const result = await auditService.list({
      page: page.value,
      limit: limit.value,
      entity: entityFilter.value ?? undefined,
    });
    logs.value = result.items;
    total.value = result.meta.total;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

watch([page, limit, entityFilter], load);
onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      title="سجل العمليات"
      subtitle="كل عملية حساسة مسجلة مع منفذها ووقتها ومعرف تتبع الطلب"
    />

    <v-card>
      <div class="d-flex flex-wrap ga-3 pa-4">
        <v-select
          v-model="entityFilter"
          :items="entityOptions"
          label="نوع العنصر"
          clearable
          style="max-width: 240px"
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
        :items="logs"
        :items-length="total"
        :loading="loading"
        :items-per-page-options="[25, 50, 100]"
        item-value="id"
      >
        <template #item.action="{ item }">
          <v-chip :color="ACTION_COLORS[item.action] ?? 'default'" size="small" variant="tonal">
            {{ AUDIT_ACTION_LABELS[item.action] ?? item.action }}
          </v-chip>
        </template>

        <template #item.entity="{ item }">
          <span class="text-body-2">{{ AUDIT_ENTITY_LABELS[item.entity] ?? item.entity }}</span>
        </template>

        <template #item.user="{ item }">
          <div v-if="item.user" class="py-1">
            <div class="text-body-2">{{ item.user.fullName }}</div>
            <div class="text-caption text-medium-emphasis numeric">{{ item.user.email }}</div>
          </div>
          <span v-else class="text-medium-emphasis">النظام</span>
        </template>

        <template #item.createdAt="{ item }">
          <span class="text-body-2">{{ formatDateTime(item.createdAt) }}</span>
        </template>

        <template #no-data>
          <EmptyState
            icon="mdi-clipboard-text-off-outline"
            title="لا توجد عمليات مسجلة"
            description="ستظهر هنا العمليات الحساسة مثل إنشاء المستخدمين وتعديل الصلاحيات."
          />
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>
