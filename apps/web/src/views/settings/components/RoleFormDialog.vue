<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { rolesService } from '@/services/roles.service';
import type { PermissionGroup, Role } from '@/types/users';

const props = defineProps<{
  modelValue: boolean;
  role: Role | null;
  permissionGroups: PermissionGroup[];
}>();

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>();

const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const formRef = ref();
const form = ref({ name: '', nameAr: '', description: '' });
const selected = ref<Set<string>>(new Set());

const isEdit = computed(() => Boolean(props.role));
const readOnly = computed(() => props.role?.isSystem === true);

const selectedCount = computed(() => selected.value.size);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;

    errorMessage.value = null;
    fieldErrors.value = [];

    form.value = {
      name: props.role?.name ?? '',
      nameAr: props.role?.nameAr ?? '',
      description: props.role?.description ?? '',
    };
    selected.value = new Set(props.role?.permissions ?? []);
  },
);

function toggle(key: string): void {
  if (readOnly.value) return;

  const next = new Set(selected.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  selected.value = next;
}

function groupState(group: PermissionGroup): 'all' | 'some' | 'none' {
  const chosen = group.permissions.filter((permission) => selected.value.has(permission.key)).length;
  if (chosen === 0) return 'none';
  return chosen === group.permissions.length ? 'all' : 'some';
}

/** Toggling a whole section is what makes a 42-permission matrix usable. */
function toggleGroup(group: PermissionGroup): void {
  if (readOnly.value) return;

  const next = new Set(selected.value);
  const selectAll = groupState(group) !== 'all';

  for (const permission of group.permissions) {
    if (selectAll) {
      next.add(permission.key);
    } else {
      next.delete(permission.key);
    }
  }
  selected.value = next;
}

async function onSubmit(): Promise<void> {
  if (readOnly.value) {
    emit('update:modelValue', false);
    return;
  }

  const { valid } = await formRef.value.validate();
  if (!valid) return;

  if (selected.value.size === 0) {
    errorMessage.value = 'اختر صلاحية واحدة على الأقل';
    return;
  }

  const payload = {
    name: form.value.name,
    nameAr: form.value.nameAr,
    description: form.value.description || undefined,
    permissions: [...selected.value],
  };

  await submit(
    () => (props.role ? rolesService.update(props.role.id, payload) : rolesService.create(payload)),
    {
      successMessage: props.role ? 'تم تحديث الدور' : 'تم إنشاء الدور',
      onSuccess: () => {
        emit('saved');
        emit('update:modelValue', false);
      },
    },
  );
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    scrollable
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
        {{ readOnly ? `صلاحيات ${role?.nameAr}` : isEdit ? 'تعديل الدور' : 'دور مخصص جديد' }}
      </v-card-title>

      <v-divider />

      <v-card-text style="max-height: 70vh">
        <v-alert v-if="readOnly" type="info" density="comfortable" class="mb-4">
          هذا دور افتراضي للعرض فقط. لتغيير الصلاحيات أنشئ دوراً مخصصاً.
        </v-alert>

        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
          <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
            <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
          </ul>
        </v-alert>

        <v-form ref="formRef">
          <v-row dense class="mb-2">
            <v-col cols="12" md="6">
              <v-text-field
                v-model="form.nameAr"
                label="اسم الدور بالعربية"
                :readonly="readOnly"
                :rules="[rules.required(), rules.minLength(2)]"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="form.name"
                label="اسم الدور بالإنجليزية"
                dir="ltr"
                :readonly="readOnly"
                :rules="[rules.required(), rules.minLength(2)]"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field v-model="form.description" label="الوصف (اختياري)" :readonly="readOnly" />
            </v-col>
          </v-row>
        </v-form>

        <div class="d-flex align-center justify-space-between mt-4 mb-2">
          <span class="text-subtitle-2 font-weight-bold">الصلاحيات</span>
          <v-chip size="small" variant="tonal">
            <span class="numeric">{{ selectedCount }}</span>&nbsp;محددة
          </v-chip>
        </div>

        <v-expansion-panels variant="accordion" multiple>
          <v-expansion-panel v-for="group in permissionGroups" :key="group.group">
            <v-expansion-panel-title>
              <div class="d-flex align-center ga-3 flex-grow-1">
                <v-checkbox-btn
                  :model-value="groupState(group) === 'all'"
                  :indeterminate="groupState(group) === 'some'"
                  :disabled="readOnly"
                  density="compact"
                  @click.stop="toggleGroup(group)"
                />
                <span class="text-body-2 font-weight-medium">{{ group.groupLabel }}</span>
                <v-spacer />
                <span class="text-caption text-medium-emphasis me-2 numeric">
                  {{ group.permissions.filter((p) => selected.has(p.key)).length }} /
                  {{ group.permissions.length }}
                </span>
              </div>
            </v-expansion-panel-title>

            <v-expansion-panel-text>
              <v-row dense>
                <v-col v-for="permission in group.permissions" :key="permission.key" cols="12" sm="6">
                  <v-checkbox
                    :model-value="selected.has(permission.key)"
                    :label="permission.description"
                    :disabled="readOnly"
                    density="compact"
                    hide-details
                    @update:model-value="toggle(permission.key)"
                  />
                </v-col>
              </v-row>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          {{ readOnly ? 'إغلاق' : 'إلغاء' }}
        </v-btn>
        <v-btn v-if="!readOnly" color="primary" :loading="submitting" @click="onSubmit">حفظ</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
