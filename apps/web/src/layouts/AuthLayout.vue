<script setup lang="ts">
const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'منصة المبيعات الذكية';

const highlights = [
  { icon: 'mdi-robot-happy-outline', text: 'مساعد ذكي يرد على زبائنك على مدار الساعة' },
  { icon: 'mdi-whatsapp', text: 'واتساب وإنستغرام وفيسبوك في صندوق واحد' },
  { icon: 'mdi-cart-check', text: 'تحويل المحادثة إلى طلب وتحديث المخزون تلقائياً' },
];
</script>

<template>
  <v-main class="auth-layout">
    <v-container fluid class="fill-height pa-0">
      <v-row no-gutters class="fill-height">
        <!-- Value proposition, hidden on phones where the form should own the screen. -->
        <v-col cols="12" md="6" lg="7" class="d-none d-md-flex brand-panel pa-10">
          <div class="ma-auto" style="max-width: 480px">
            <v-avatar color="white" size="56" rounded="lg" class="mb-6">
              <v-icon icon="mdi-storefront-outline" size="32" color="primary" />
            </v-avatar>

            <h2 class="text-h4 font-weight-bold text-white mb-3">{{ APP_NAME }}</h2>
            <p class="text-body-1 text-white mb-8" style="opacity: 0.85">
              أدر مبيعاتك القادمة من وسائل التواصل الاجتماعي من مكان واحد، ودع الذكاء
              الاصطناعي يتكفل بالرد على الزبائن وإنشاء الطلبات.
            </p>

            <div v-for="item in highlights" :key="item.text" class="d-flex align-center ga-3 mb-4">
              <v-avatar color="rgba(255,255,255,0.16)" size="40" rounded="lg">
                <v-icon :icon="item.icon" color="white" />
              </v-avatar>
              <span class="text-body-2 text-white" style="opacity: 0.9">{{ item.text }}</span>
            </div>
          </div>
        </v-col>

        <v-col cols="12" md="6" lg="5" class="d-flex align-center justify-center pa-6">
          <div style="width: 100%; max-width: 440px">
            <router-view />
          </div>
        </v-col>
      </v-row>
    </v-container>
  </v-main>
</template>

<style scoped>
.brand-panel {
  background: linear-gradient(135deg, #1867c0 0%, #0f766e 100%);
}
</style>
