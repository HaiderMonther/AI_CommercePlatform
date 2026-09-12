<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const form = ref({ companyName: '', fullName: '', email: '', phone: '', password: '' });
const showPassword = ref(false);
const formRef = ref();

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  await submit(
    () =>
      auth.register({
        companyName: form.value.companyName,
        fullName: form.value.fullName,
        email: form.value.email,
        password: form.value.password,
        ...(form.value.phone ? { phone: form.value.phone } : {}),
      }),
    {
      onSuccess: () => {
        ui.success('تم إنشاء متجرك بنجاح، أهلاً بك');
        router.push({ name: 'dashboard' });
      },
    },
  );
}
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-h5 font-weight-bold mb-1">أنشئ متجرك</h1>
      <p class="text-body-2 text-medium-emphasis">ابدأ فترة تجريبية مجانية لمدة 14 يوماً</p>
    </div>

    <v-alert v-if="errorMessage" type="error" class="mb-4" density="comfortable">
      {{ errorMessage }}
      <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
        <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
      </ul>
    </v-alert>

    <v-form ref="formRef" @submit.prevent="onSubmit">
      <v-text-field
        v-model="form.companyName"
        label="اسم المتجر أو الشركة"
        prepend-inner-icon="mdi-storefront-outline"
        :rules="[rules.required(), rules.minLength(2), rules.maxLength(120)]"
        class="mb-4"
      />

      <v-text-field
        v-model="form.fullName"
        label="اسمك الكامل"
        prepend-inner-icon="mdi-account-outline"
        :rules="[rules.required(), rules.minLength(2)]"
        class="mb-4"
      />

      <v-text-field
        v-model="form.email"
        label="البريد الإلكتروني"
        type="email"
        autocomplete="username"
        dir="ltr"
        prepend-inner-icon="mdi-email-outline"
        :rules="[rules.required(), rules.email()]"
        class="mb-4"
      />

      <v-text-field
        v-model="form.phone"
        label="رقم الهاتف (اختياري)"
        dir="ltr"
        placeholder="+9647701234567"
        prepend-inner-icon="mdi-phone-outline"
        :rules="[rules.phone()]"
        class="mb-4"
      />

      <v-text-field
        v-model="form.password"
        label="كلمة المرور"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="new-password"
        dir="ltr"
        prepend-inner-icon="mdi-lock-outline"
        :append-inner-icon="showPassword ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
        :rules="[rules.required(), rules.password()]"
        hint="8 أحرف على الأقل مع حرف كبير وحرف صغير ورقم"
        persistent-hint
        class="mb-6"
        @click:append-inner="showPassword = !showPassword"
      />

      <v-btn type="submit" color="primary" size="large" block :loading="submitting">
        إنشاء الحساب
      </v-btn>
    </v-form>

    <div class="text-center text-body-2 mt-6">
      لديك حساب بالفعل؟
      <router-link :to="{ name: 'login' }" class="text-primary font-weight-medium">
        تسجيل الدخول
      </router-link>
    </div>
  </div>
</template>
