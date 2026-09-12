<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <v-main class="d-flex align-center justify-center">
    <div class="text-center pa-6">
      <v-icon icon="mdi-shield-lock-outline" size="72" color="warning" class="mb-4" />
      <h1 class="text-h5 font-weight-bold mb-2">غير مصرح لك بالوصول</h1>
      <p class="text-body-2 text-medium-emphasis mb-6">
        هذه الصفحة تتطلب صلاحية لا يملكها حسابك. تواصل مع مدير الشركة لمنحك الصلاحية.
      </p>
      <v-btn color="primary" prepend-icon="mdi-home-outline" @click="router.push({ name: 'dashboard' })">
        العودة إلى لوحة التحكم
      </v-btn>
    </div>
  </v-main>
</template>
