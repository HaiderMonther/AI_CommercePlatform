<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import ConfirmDialog from '@/components/data/ConfirmDialog.vue';
import EmptyState from '@/components/data/EmptyState.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import UserFormDialog from './components/UserFormDialog.vue';
import { PERMISSIONS } from '@/constants/permissions';
import { USER_STATUS_COLORS, USER_STATUS_LABELS } from '@/constants/labels';
import { rolesService } from '@/services/roles.service';
import { usersService } from '@/services/users.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { formatDateTime, formatRelative } from '@/utils/format';
import { ApiError } from '@/types/api';
import type { Role, User } from '@/types/users';

const auth = useAuthStore();
const ui = useUiStore();

const users = ref<User[]>([]);
const roles = ref<Role[]>([]);
const total = ref(0);
const page = ref(1);
const limit = ref(10);
const search = ref('');
const statusFilter = ref<string | null>(null);
const roleFilter = ref<string | null>(null);

const loading = ref(false);
const loadError = ref<ApiError | null>(null);

const dialogOpen = ref(false);
const editing = ref<User | null>(null);

const deleteTarget = ref<User | null>(null);
const deleting = ref(false);

const canCreate = computed(() => auth.can(PERMISSIONS.USERS_CREATE));
const canUpdate = computed(() => auth.can(PERMISSIONS.USERS_UPDATE));
const canDelete = computed(() => auth.can(PERMISSIONS.USERS_DELETE));

const headers = [
  { title: 'المستخدم', key: 'fullName', sortable: false },
  { title: 'الدور', key: 'role', sortable: false },
  { title: 'الحالة', key: 'status', sortable: false, width: 120 },
  { title: 'آخر دخول', key: 'lastLoginAt', sortable: false, width: 160 },
  { title: '', key: 'actions', sortable: false, align: 'end' as const, width: 60 },
];

const statusOptions = Object.entries(USER_STATUS_LABELS).map(([value, title]) => ({ value, title }));

const roleOptions = computed(() =>
  roles.value.map((role) => ({ value: role.id, title: role.nameAr })),
);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;

  try {
    const result = await usersService.list({
      page: page.value,
      limit: limit.value,
      search: search.value || undefined,
      status: statusFilter.value ?? undefined,
      roleId: roleFilter.value ?? undefined,
    });
    users.value = result.items;
    total.value = result.meta.total;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

async function loadRoles(): Promise<void> {
  if (!auth.can(PERMISSIONS.ROLES_READ)) return;
  try {
    roles.value = await rolesService.list();
  } catch {
    // The roles filter is optional; a failure here must not block the users table.
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

watch([page, limit, statusFilter, roleFilter], load);

onMounted(() => {
  load();
  loadRoles();
});

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(user: User): void {
  editing.value = user;
  dialogOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;

  deleting.value = true;
  try {
    await usersService.remove(deleteTarget.value.id);
    ui.success('تم حذف المستخدم');
    deleteTarget.value = null;
    await load();
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر حذف المستخدم');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader title="المستخدمون" subtitle="إدارة فريق العمل وصلاحياتهم">
      <template #actions>
        <v-btn v-if="canCreate" color="primary" prepend-icon="mdi-plus" @click="openCreate">
          إضافة مستخدم
        </v-btn>
      </template>
    </PageHeader>

    <v-card>
      <div class="d-flex flex-wrap ga-3 pa-4">
        <v-text-field
          v-model="search"
          placeholder="ابحث بالاسم أو البريد أو الهاتف"
          prepend-inner-icon="mdi-magnify"
          clearable
          style="min-width: 240px; max-width: 360px"
        />
        <v-select
          v-model="statusFilter"
          :items="statusOptions"
          label="الحالة"
          clearable
          style="max-width: 180px"
        />
        <v-select
          v-if="roleOptions.length"
          v-model="roleFilter"
          :items="roleOptions"
          label="الدور"
          clearable
          style="max-width: 200px"
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
        :items="users"
        :items-length="total"
        :loading="loading"
        :items-per-page-options="[10, 25, 50]"
        item-value="id"
      >
        <template #item.fullName="{ item }">
          <div class="d-flex align-center ga-3 py-2">
            <v-avatar color="primary" variant="tonal" size="36">
              <v-icon icon="mdi-account" size="20" />
            </v-avatar>
            <div class="min-w-0">
              <div class="text-body-2 font-weight-medium text-truncate">{{ item.fullName }}</div>
              <div class="text-caption text-medium-emphasis text-truncate numeric">
                {{ item.email }}
              </div>
            </div>
          </div>
        </template>

        <template #item.role="{ item }">
          <v-chip v-if="item.role" size="small" variant="tonal">{{ item.role.nameAr }}</v-chip>
          <span v-else class="text-medium-emphasis">—</span>
        </template>

        <template #item.status="{ item }">
          <v-chip :color="USER_STATUS_COLORS[item.status]" size="small" variant="tonal">
            {{ USER_STATUS_LABELS[item.status] }}
          </v-chip>
        </template>

        <template #item.lastLoginAt="{ item }">
          <span v-if="item.lastLoginAt" :title="formatDateTime(item.lastLoginAt)" class="text-body-2">
            {{ formatRelative(item.lastLoginAt) }}
          </span>
          <span v-else class="text-medium-emphasis">لم يسجل الدخول</span>
        </template>

        <template #item.actions="{ item }">
          <v-menu v-if="canUpdate || canDelete" location="bottom end">
            <template #activator="{ props }">
              <v-btn v-bind="props" icon="mdi-dots-vertical" variant="text" size="small" />
            </template>
            <v-list density="compact">
              <v-list-item
                v-if="canUpdate"
                prepend-icon="mdi-pencil-outline"
                title="تعديل"
                @click="openEdit(item)"
              />
              <v-list-item
                v-if="canDelete && item.id !== auth.user?.id"
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
            icon="mdi-account-off-outline"
            title="لا يوجد مستخدمون مطابقون"
            description="جرّب تغيير معايير البحث أو أضف مستخدماً جديداً."
            :action-label="canCreate ? 'إضافة مستخدم' : undefined"
            @action="openCreate"
          />
        </template>
      </v-data-table-server>
    </v-card>

    <UserFormDialog
      v-model="dialogOpen"
      :user="editing"
      :roles="roles"
      @saved="load"
    />

    <ConfirmDialog
      :model-value="Boolean(deleteTarget)"
      title="حذف المستخدم"
      :message="`سيتم حذف «${deleteTarget?.fullName ?? ''}» وإنهاء جلساته. يمكن دعوته مجدداً لاحقاً.`"
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
