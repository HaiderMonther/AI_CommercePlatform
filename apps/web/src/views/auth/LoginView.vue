<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const route = useRoute();
const { submitting, errorMessage, submit } = useFormSubmit();

const form = ref({ email: '', password: '' });
const showPassword = ref(false);
const formRef = ref();

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  await submit(() => auth.login({ ...form.value }), {
    onSuccess: () => {
      ui.success(`أهلاً بك ${auth.user?.fullName ?? ''}`);
      const redirect = route.query.redirect as string | undefined;
      router.push(redirect ?? { name: 'dashboard' });
    },
  });
}
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-h5 font-weight-bold mb-1">تسجيل الدخول</h1>
      <p class="text-body-2 text-medium-emphasis">أدخل بياناتك للوصول إلى لوحة التحكم</p>
    </div>

    <v-alert v-if="auth.sessionExpired" type="warning" class="mb-4" density="comfortable">
      انتهت جلستك، الرجاء تسجيل الدخول مجدداً.
    </v-alert>

    <v-alert v-if="errorMessage" type="error" class="mb-4" density="comfortable">
      {{ errorMessage }}
    </v-alert>

    <v-form ref="formRef" @submit.prevent="onSubmit">
      <v-text-field
        v-model="form.email"
        label="البريد الإلكتروني"
        type="email"
        autocomplete="username"
        prepend-inner-icon="mdi-email-outline"
        dir="ltr"
        :rules="[rules.required(), rules.email()]"
        class="mb-4"
      />

      <v-text-field
        v-model="form.password"
        label="كلمة المرور"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="current-password"
        prepend-inner-icon="mdi-lock-outline"
        :append-inner-icon="showPassword ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
        dir="ltr"
        :rules="[rules.required()]"
        class="mb-6"
        @click:append-inner="showPassword = !showPassword"
      />

      <v-btn type="submit" color="primary" size="large" block :loading="submitting">
        دخول
      </v-btn>
    </v-form>

    <div class="text-center text-body-2 mt-6">
      ليس لديك حساب؟
      <router-link :to="{ name: 'register' }" class="text-primary font-weight-medium">
        أنشئ متجرك الآن
      </router-link>
    </div>
  </div>
</template>
