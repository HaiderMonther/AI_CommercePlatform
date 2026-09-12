<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <v-main class="d-flex align-center justify-center">
    <div class="text-center pa-6">
      <div class="text-h2 font-weight-bold text-primary mb-2 numeric">404</div>
      <h1 class="text-h6 font-weight-bold mb-2">الصفحة غير موجودة</h1>
      <p class="text-body-2 text-medium-emphasis mb-6">
        الرابط الذي فتحته غير صحيح أو تم نقل الصفحة.
      </p>
      <v-btn color="primary" prepend-icon="mdi-home-outline" @click="router.push('/')">
        العودة إلى الرئيسية
      </v-btn>
    </div>
  </v-main>
</template>
