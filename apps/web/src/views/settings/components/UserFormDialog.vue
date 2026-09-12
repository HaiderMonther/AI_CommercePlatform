<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { USER_STATUS_LABELS } from '@/constants/labels';
import { usersService } from '@/services/users.service';
import type { Role, User } from '@/types/users';

const props = defineProps<{
  modelValue: boolean;
  user: User | null;
  roles: Role[];
}>();

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>();

const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const formRef = ref();
const showPassword = ref(false);

const form = ref({
  email: '',
  fullName: '',
  phone: '',
  password: '',
  roleId: '',
  status: 'ACTIVE' as User['status'],
});

const isEdit = computed(() => Boolean(props.user));

const roleOptions = computed(() =>
  props.roles.map((role) => ({
    value: role.id,
    title: role.nameAr,
    subtitle: role.description ?? '',
  })),
);

const statusOptions = Object.entries(USER_STATUS_LABELS).map(([value, title]) => ({ value, title }));

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;

    errorMessage.value = null;
    fieldErrors.value = [];

    form.value = props.user
      ? {
          email: props.user.email,
          fullName: props.user.fullName,
          phone: props.user.phone ?? '',
          password: '',
          roleId: props.user.roleId ?? '',
          status: props.user.status,
        }
      : { email: '', fullName: '', phone: '', password: '', roleId: '', status: 'ACTIVE' };
  },
);

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  const action = () =>
    props.user
      ? usersService.update(props.user.id, {
          fullName: form.value.fullName,
          phone: form.value.phone || undefined,
          roleId: form.value.roleId,
          status: form.value.status,
        })
      : usersService.create({
          email: form.value.email,
          fullName: form.value.fullName,
          password: form.value.password,
          roleId: form.value.roleId,
          phone: form.value.phone || undefined,
          status: form.value.status,
        });

  await submit(action, {
    successMessage: props.user ? 'تم تحديث المستخدم' : 'تم إنشاء المستخدم',
    onSuccess: () => {
      emit('saved');
      emit('update:modelValue', false);
    },
  });
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
        {{ isEdit ? 'تعديل مستخدم' : 'إضافة مستخدم' }}
      </v-card-title>

      <v-divider />

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
          <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
            <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
          </ul>
        </v-alert>

        <v-form ref="formRef" @submit.prevent="onSubmit">
          <v-text-field
            v-model="form.fullName"
            label="الاسم الكامل"
            :rules="[rules.required(), rules.minLength(2)]"
            class="mb-4"
          />

          <!-- Email is the login identity and is referenced by the audit trail, so it is
               fixed once the account exists. -->
          <v-text-field
            v-model="form.email"
            label="البريد الإلكتروني"
            type="email"
            dir="ltr"
            :disabled="isEdit"
            :hint="isEdit ? 'لا يمكن تغيير البريد بعد إنشاء الحساب' : undefined"
            :persistent-hint="isEdit"
            :rules="isEdit ? [] : [rules.required(), rules.email()]"
            class="mb-4"
          />

          <v-text-field
            v-if="!isEdit"
            v-model="form.password"
            label="كلمة المرور"
            :type="showPassword ? 'text' : 'password'"
            dir="ltr"
            :append-inner-icon="showPassword ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
            :rules="[rules.required(), rules.password()]"
            class="mb-4"
            @click:append-inner="showPassword = !showPassword"
          />

          <v-text-field
            v-model="form.phone"
            label="رقم الهاتف (اختياري)"
            dir="ltr"
            placeholder="+9647701234567"
            :rules="[rules.phone()]"
            class="mb-4"
          />

          <v-select
            v-model="form.roleId"
            :items="roleOptions"
            label="الدور"
            :rules="[rules.required('اختر دوراً للمستخدم')]"
            class="mb-4"
          />

          <v-select v-model="form.status" :items="statusOptions" label="الحالة" />
        </v-form>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn color="primary" :loading="submitting" @click="onSubmit">حفظ</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
