<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import PageHeader from '@/components/layout/PageHeader.vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { authService } from '@/services/auth.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const formRef = ref();
const showPasswords = ref(false);
const form = ref({ currentPassword: '', newPassword: '', confirmPassword: '' });

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  await submit(
    () => authService.changePassword(form.value.currentPassword, form.value.newPassword),
    {
      onSuccess: async () => {
        // The API revokes every session on a password change, so the user re-authenticates.
        ui.success('تم تغيير كلمة المرور، الرجاء تسجيل الدخول مجدداً');
        auth.clear();
        await router.push({ name: 'login' });
      },
    },
  );
}
</script>

<template>
  <div>
    <PageHeader title="حسابي" subtitle="بياناتك الشخصية وأمان الحساب" />

    <v-row dense>
      <v-col cols="12" md="5">
        <v-card class="pa-4 pa-md-6 text-center">
          <v-avatar color="primary" size="80" class="mb-3">
            <v-icon icon="mdi-account" size="44" />
          </v-avatar>

          <div class="text-subtitle-1 font-weight-bold">{{ auth.user?.fullName }}</div>
          <div class="text-body-2 text-medium-emphasis numeric mb-3">{{ auth.user?.email }}</div>

          <v-chip color="primary" variant="tonal" size="small">
            {{ auth.user?.roleName ?? 'بدون دور' }}
          </v-chip>

          <v-divider class="my-4" />

          <div class="d-flex justify-space-between text-body-2 mb-2">
            <span class="text-medium-emphasis">الشركة</span>
            <span>{{ auth.company?.name ?? '—' }}</span>
          </div>
          <div class="d-flex justify-space-between text-body-2">
            <span class="text-medium-emphasis">عدد الصلاحيات</span>
            <span class="numeric">{{ auth.user?.permissions.length ?? 0 }}</span>
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" md="7">
        <v-card class="pa-4 pa-md-6">
          <div class="text-subtitle-2 font-weight-bold mb-1">تغيير كلمة المرور</div>
          <p class="text-body-2 text-medium-emphasis mb-4">
            سيتم إنهاء جميع جلساتك على الأجهزة الأخرى بعد التغيير.
          </p>

          <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
            {{ errorMessage }}
            <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
              <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
            </ul>
          </v-alert>

          <v-form ref="formRef" @submit.prevent="onSubmit">
            <v-text-field
              v-model="form.currentPassword"
              label="كلمة المرور الحالية"
              :type="showPasswords ? 'text' : 'password'"
              dir="ltr"
              autocomplete="current-password"
              :rules="[rules.required()]"
              class="mb-4"
            />

            <v-text-field
              v-model="form.newPassword"
              label="كلمة المرور الجديدة"
              :type="showPasswords ? 'text' : 'password'"
              dir="ltr"
              autocomplete="new-password"
              :append-inner-icon="showPasswords ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
              :rules="[rules.required(), rules.password()]"
              class="mb-4"
              @click:append-inner="showPasswords = !showPasswords"
            />

            <v-text-field
              v-model="form.confirmPassword"
              label="تأكيد كلمة المرور الجديدة"
              :type="showPasswords ? 'text' : 'password'"
              dir="ltr"
              autocomplete="new-password"
              :rules="[rules.required(), rules.matches(() => form.newPassword)]"
              class="mb-6"
            />

            <div class="d-flex justify-end">
              <v-btn color="primary" type="submit" :loading="submitting">تغيير كلمة المرور</v-btn>
            </div>
          </v-form>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
