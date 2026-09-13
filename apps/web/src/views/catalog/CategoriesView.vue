<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ConfirmDialog from '@/components/data/ConfirmDialog.vue';
import EmptyState from '@/components/data/EmptyState.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import { PERMISSIONS } from '@/constants/permissions';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { categoriesService } from '@/services/catalog.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type { Category, CategoryTreeNode } from '@/types/users';

const auth = useAuthStore();
const ui = useUiStore();
const { submitting, errorMessage, submit } = useFormSubmit();

const tree = ref<CategoryTreeNode[]>([]);
const flat = ref<Category[]>([]);
const loading = ref(false);
const loadError = ref<ApiError | null>(null);

const dialogOpen = ref(false);
const editing = ref<Category | null>(null);
const formRef = ref();
const form = ref({ name: '', parentId: null as string | null, description: '', isActive: true });

const deleteTarget = ref<Category | null>(null);
const deleting = ref(false);

const canCreate = computed(() => auth.can(PERMISSIONS.CATEGORIES_CREATE));
const canUpdate = computed(() => auth.can(PERMISSIONS.CATEGORIES_UPDATE));
const canDelete = computed(() => auth.can(PERMISSIONS.CATEGORIES_DELETE));

/** Only root categories may be parents: the API caps nesting and two levels is what a
 *  merchant catalog actually needs. */
const parentOptions = computed(() =>
  flat.value
    .filter((category) => !category.parentId && category.id !== editing.value?.id)
    .map((category) => ({ value: category.id, title: category.name })),
);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;

  try {
    const [treeResult, flatResult] = await Promise.all([
      categoriesService.tree(),
      categoriesService.list(),
    ]);
    tree.value = treeResult;
    flat.value = flatResult;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openCreate(parentId: string | null = null): void {
  editing.value = null;
  form.value = { name: '', parentId, description: '', isActive: true };
  errorMessage.value = null;
  dialogOpen.value = true;
}

function openEdit(category: Category): void {
  editing.value = category;
  form.value = {
    name: category.name,
    parentId: category.parentId,
    description: category.description ?? '',
    isActive: category.isActive,
  };
  errorMessage.value = null;
  dialogOpen.value = true;
}

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  const payload = {
    name: form.value.name,
    parentId: form.value.parentId,
    description: form.value.description || undefined,
    isActive: form.value.isActive,
  };

  await submit(
    () =>
      editing.value
        ? categoriesService.update(editing.value.id, payload)
        : categoriesService.create(payload),
    {
      successMessage: editing.value ? 'تم تحديث التصنيف' : 'تم إنشاء التصنيف',
      onSuccess: async () => {
        dialogOpen.value = false;
        await load();
      },
    },
  );
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;

  deleting.value = true;
  try {
    await categoriesService.remove(deleteTarget.value.id);
    ui.success('تم حذف التصنيف');
    deleteTarget.value = null;
    await load();
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر حذف التصنيف');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader title="التصنيفات" subtitle="نظّم منتجاتك لتسهيل البحث والعرض">
      <template #actions>
        <v-btn v-if="canCreate" color="primary" prepend-icon="mdi-plus" @click="openCreate()">
          تصنيف جديد
        </v-btn>
      </template>
    </PageHeader>

    <ErrorState
      v-if="loadError"
      :message="loadError.message"
      :correlation-id="loadError.correlationId"
      @retry="load"
    />

    <v-card v-else>
      <v-skeleton-loader v-if="loading" type="list-item-avatar@5" class="pa-2" />

      <EmptyState
        v-else-if="tree.length === 0"
        icon="mdi-shape-outline"
        title="لا توجد تصنيفات"
        description="أنشئ تصنيفات مثل «ملابس رجالية» و«أحذية» لتنظيم الكتالوج."
        :action-label="canCreate ? 'تصنيف جديد' : undefined"
        @action="openCreate()"
      />

      <v-list v-else density="comfortable">
        <template v-for="parent in tree" :key="parent.id">
          <v-list-item>
            <template #prepend>
              <v-avatar color="primary" variant="tonal" rounded="lg" size="38">
                <v-icon icon="mdi-folder-outline" />
              </v-avatar>
            </template>

            <v-list-item-title class="font-weight-medium">{{ parent.name }}</v-list-item-title>
            <v-list-item-subtitle>
              <span class="numeric">{{ parent.productsCount }}</span> منتج
              <span v-if="!parent.isActive" class="text-warning"> · متوقف</span>
            </v-list-item-subtitle>

            <template #append>
              <v-btn
                v-if="canCreate"
                icon="mdi-plus"
                size="small"
                variant="text"
                title="تصنيف فرعي"
                @click="openCreate(parent.id)"
              />
              <v-btn
                v-if="canUpdate"
                icon="mdi-pencil-outline"
                size="small"
                variant="text"
                @click="openEdit(parent)"
              />
              <v-btn
                v-if="canDelete"
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                color="error"
                @click="deleteTarget = parent"
              />
            </template>
          </v-list-item>

          <v-list-item v-for="child in parent.children" :key="child.id" class="ps-12">
            <template #prepend>
              <v-icon icon="mdi-subdirectory-arrow-left" size="18" class="me-3 text-medium-emphasis" />
            </template>

            <v-list-item-title class="text-body-2">{{ child.name }}</v-list-item-title>
            <v-list-item-subtitle>
              <span class="numeric">{{ child.productsCount }}</span> منتج
            </v-list-item-subtitle>

            <template #append>
              <v-btn
                v-if="canUpdate"
                icon="mdi-pencil-outline"
                size="small"
                variant="text"
                @click="openEdit(child)"
              />
              <v-btn
                v-if="canDelete"
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                color="error"
                @click="deleteTarget = child"
              />
            </template>
          </v-list-item>

          <v-divider />
        </template>
      </v-list>
    </v-card>

    <v-dialog v-model="dialogOpen" max-width="520" persistent>
      <v-card>
        <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
          {{ editing ? 'تعديل التصنيف' : 'تصنيف جديد' }}
        </v-card-title>

        <v-divider />

        <v-card-text>
          <v-alert v-if="errorMessage" type="error" density="compact" class="mb-4">
            {{ errorMessage }}
          </v-alert>

          <v-form ref="formRef">
            <v-text-field
              v-model="form.name"
              label="اسم التصنيف"
              :rules="[rules.required(), rules.minLength(2)]"
              class="mb-4"
            />

            <v-select
              v-model="form.parentId"
              :items="parentOptions"
              label="التصنيف الأب (اختياري)"
              clearable
              class="mb-4"
            />

            <v-text-field v-model="form.description" label="الوصف (اختياري)" class="mb-4" />

            <v-switch
              v-model="form.isActive"
              label="مفعّل"
              color="primary"
              hide-details
              density="comfortable"
            />
          </v-form>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-4 py-3">
          <v-spacer />
          <v-btn variant="text" :disabled="submitting" @click="dialogOpen = false">إلغاء</v-btn>
          <v-btn color="primary" :loading="submitting" @click="onSubmit">حفظ</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      :model-value="Boolean(deleteTarget)"
      title="حذف التصنيف"
      :message="`سيتم حذف «${deleteTarget?.name ?? ''}». التصنيف الذي يحتوي منتجات أو فروعاً لا يمكن حذفه.`"
      confirm-label="حذف"
      :loading="deleting"
      @update:model-value="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>
