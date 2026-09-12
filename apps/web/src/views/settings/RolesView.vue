<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ConfirmDialog from '@/components/data/ConfirmDialog.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import RoleFormDialog from './components/RoleFormDialog.vue';
import { PERMISSIONS } from '@/constants/permissions';
import { rolesService } from '@/services/roles.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type { PermissionGroup, Role } from '@/types/users';

const auth = useAuthStore();
const ui = useUiStore();

const roles = ref<Role[]>([]);
const permissionGroups = ref<PermissionGroup[]>([]);
const loading = ref(false);
const loadError = ref<ApiError | null>(null);

const dialogOpen = ref(false);
const editing = ref<Role | null>(null);

const deleteTarget = ref<Role | null>(null);
const deleting = ref(false);

const canCreate = computed(() => auth.can(PERMISSIONS.ROLES_CREATE));
const canUpdate = computed(() => auth.can(PERMISSIONS.ROLES_UPDATE));
const canDelete = computed(() => auth.can(PERMISSIONS.ROLES_DELETE));

const totalPermissions = computed(() =>
  permissionGroups.value.reduce((sum, group) => sum + group.permissions.length, 0),
);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;

  try {
    const [roleList, groups] = await Promise.all([rolesService.list(), rolesService.permissions()]);
    roles.value = roleList;
    permissionGroups.value = groups;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(role: Role): void {
  editing.value = role;
  dialogOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;

  deleting.value = true;
  try {
    await rolesService.remove(deleteTarget.value.id);
    ui.success('تم حذف الدور');
    deleteTarget.value = null;
    await load();
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر حذف الدور');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="الأدوار والصلاحيات"
      subtitle="حدد ما يستطيع كل موظف رؤيته وتعديله داخل النظام"
    >
      <template #actions>
        <v-btn v-if="canCreate" color="primary" prepend-icon="mdi-plus" @click="openCreate">
          دور مخصص
        </v-btn>
      </template>
    </PageHeader>

    <ErrorState
      v-if="loadError"
      :message="loadError.message"
      :correlation-id="loadError.correlationId"
      @retry="load"
    />

    <v-row v-else dense>
      <template v-if="loading">
        <v-col v-for="index in 5" :key="index" cols="12" md="6" lg="4">
          <v-skeleton-loader type="article" class="rounded-lg" />
        </v-col>
      </template>

      <v-col v-for="role in roles" v-else :key="role.id" cols="12" md="6" lg="4">
        <v-card class="pa-4 h-100 d-flex flex-column">
          <div class="d-flex align-start justify-space-between ga-2 mb-2">
            <div class="min-w-0">
              <div class="d-flex align-center ga-2">
                <span class="text-subtitle-1 font-weight-bold text-truncate">
                  {{ role.nameAr }}
                </span>
                <!-- System roles ship with the product; companies extend by cloning. -->
                <v-chip v-if="role.isSystem" size="x-small" variant="tonal" color="info">
                  افتراضي
                </v-chip>
              </div>
              <div class="text-caption text-medium-emphasis numeric">{{ role.key }}</div>
            </div>

            <v-menu v-if="!role.isSystem && (canUpdate || canDelete)" location="bottom end">
              <template #activator="{ props }">
                <v-btn v-bind="props" icon="mdi-dots-vertical" variant="text" size="small" />
              </template>
              <v-list density="compact">
                <v-list-item
                  v-if="canUpdate"
                  prepend-icon="mdi-pencil-outline"
                  title="تعديل"
                  @click="openEdit(role)"
                />
                <v-list-item
                  v-if="canDelete"
                  prepend-icon="mdi-delete-outline"
                  title="حذف"
                  base-color="error"
                  :disabled="role.usersCount > 0"
                  @click="deleteTarget = role"
                />
              </v-list>
            </v-menu>

            <v-btn
              v-else-if="role.isSystem"
              icon="mdi-eye-outline"
              variant="text"
              size="small"
              title="عرض الصلاحيات"
              @click="openEdit(role)"
            />
          </div>

          <p class="text-body-2 text-medium-emphasis mb-3">
            {{ role.description || 'دور بدون وصف' }}
          </p>

          <v-spacer />

          <div class="d-flex align-center justify-space-between text-caption">
            <span class="d-flex align-center ga-1">
              <v-icon icon="mdi-account-multiple-outline" size="16" />
              <span class="numeric">{{ role.usersCount }}</span> مستخدم
            </span>
            <span class="d-flex align-center ga-1">
              <v-icon icon="mdi-key-outline" size="16" />
              <span class="numeric">{{ role.permissions.length }}</span> /
              <span class="numeric">{{ totalPermissions }}</span> صلاحية
            </span>
          </div>

          <v-progress-linear
            :model-value="totalPermissions ? (role.permissions.length / totalPermissions) * 100 : 0"
            color="primary"
            height="4"
            rounded
            class="mt-2"
          />
        </v-card>
      </v-col>
    </v-row>

    <RoleFormDialog
      v-model="dialogOpen"
      :role="editing"
      :permission-groups="permissionGroups"
      @saved="load"
    />

    <ConfirmDialog
      :model-value="Boolean(deleteTarget)"
      title="حذف الدور"
      :message="`سيتم حذف دور «${deleteTarget?.nameAr ?? ''}» نهائياً.`"
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
