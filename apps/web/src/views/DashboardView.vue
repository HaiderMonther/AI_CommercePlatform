<script setup lang="ts">
import { onMounted } from 'vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import StatCard from '@/components/data/StatCard.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { companyService } from '@/services/company.service';
import { useAuthStore } from '@/stores/auth.store';
import { formatNumber } from '@/utils/format';
import type { CompanyStats } from '@/types/users';

const auth = useAuthStore();

const emptyStats: CompanyStats = {
  companyId: '',
  users: 0,
  products: 0,
  customers: 0,
  orders: 0,
  channels: 0,
};

const { data: stats, loading, error, execute } = useAsyncData<CompanyStats>(
  () => companyService.stats(),
  emptyStats,
);

onMounted(execute);

/**
 * Phase 1 shows the counters the API can answer today. Sales, conversations and AI
 * metrics arrive with their own modules in Phases 3-7 rather than as fake numbers here.
 */
const setupSteps = [
  {
    title: 'أضف منتجاتك',
    description: 'ارفع المنتجات والأسعار والمخزون ليتمكن المساعد الذكي من البحث فيها.',
    icon: 'mdi-package-variant-closed',
    phase: 'المرحلة 2',
  },
  {
    title: 'اربط قنوات التواصل',
    description: 'اربط واتساب وإنستغرام وفيسبوك لاستقبال رسائل الزبائن في مكان واحد.',
    icon: 'mdi-link-variant',
    phase: 'المرحلة 5',
  },
  {
    title: 'فعّل المساعد الذكي',
    description: 'اضبط نبرة الرد وسياسات التوصيل والدفع ليتولى الرد وإنشاء الطلبات.',
    icon: 'mdi-robot-outline',
    phase: 'المرحلة 6',
  },
];
</script>

<template>
  <div>
    <PageHeader
      :title="`أهلاً ${auth.user?.fullName ?? ''}`"
      :subtitle="auth.company?.name ?? 'لوحة التحكم'"
    />

    <ErrorState
      v-if="error"
      :message="error.message"
      :correlation-id="error.correlationId"
      @retry="execute"
    />

    <template v-else>
      <v-row dense>
        <v-col cols="12" sm="6" md="4" lg="2">
          <StatCard
            title="المستخدمون"
            :value="formatNumber(stats.users)"
            icon="mdi-account-group-outline"
            :loading="loading"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <StatCard
            title="المنتجات"
            :value="formatNumber(stats.products)"
            icon="mdi-package-variant-closed"
            color="secondary"
            :loading="loading"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <StatCard
            title="الزبائن"
            :value="formatNumber(stats.customers)"
            icon="mdi-account-heart-outline"
            color="info"
            :loading="loading"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <StatCard
            title="الطلبات"
            :value="formatNumber(stats.orders)"
            icon="mdi-cart-outline"
            color="success"
            :loading="loading"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <StatCard
            title="القنوات المربوطة"
            :value="formatNumber(stats.channels)"
            icon="mdi-link-variant"
            color="warning"
            :loading="loading"
          />
        </v-col>
        <v-col cols="12" sm="6" md="4" lg="2">
          <StatCard
            title="الباقة"
            :value="auth.company?.planTier === 'BUSINESS' ? 'الأعمال' : 'الأساسية'"
            icon="mdi-crown-outline"
            color="primary"
            :loading="loading"
          />
        </v-col>
      </v-row>

      <v-card class="mt-6 pa-4 pa-md-6">
        <div class="d-flex align-center ga-2 mb-1">
          <v-icon icon="mdi-rocket-launch-outline" color="primary" />
          <h2 class="text-subtitle-1 font-weight-bold">خطوات تجهيز المتجر</h2>
        </div>
        <p class="text-body-2 text-medium-emphasis mb-4">
          أنجزت إعداد الحساب والفريق والصلاحيات. الخطوات التالية تُفعّل دورة البيع كاملة.
        </p>

        <v-row dense>
          <v-col v-for="step in setupSteps" :key="step.title" cols="12" md="4">
            <v-card variant="tonal" class="pa-4 h-100">
              <div class="d-flex align-center justify-space-between mb-2">
                <v-icon :icon="step.icon" size="26" color="primary" />
                <v-chip size="x-small" variant="outlined" color="primary">
                  {{ step.phase }}
                </v-chip>
              </div>
              <div class="text-subtitle-2 font-weight-bold mb-1">{{ step.title }}</div>
              <div class="text-body-2 text-medium-emphasis">{{ step.description }}</div>
            </v-card>
          </v-col>
        </v-row>
      </v-card>
    </template>
  </div>
</template>
