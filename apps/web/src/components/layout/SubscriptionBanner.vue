<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { PERMISSIONS } from '@/constants/permissions';
import { billingService } from '@/services/billing.service';
import { useAuthStore } from '@/stores/auth.store';
import type { BillingStatus } from '@/types/billing';
import { formatCurrency, formatDate } from '@/utils/format';

/** Warns everyone in the store when the subscription needs attention; quiet otherwise. */
const auth = useAuthStore();
const status = ref<BillingStatus | null>(null);

onMounted(async () => {
  try {
    status.value = await billingService.status();
  } catch {
    // Not knowing is no reason to block the dashboard.
  }
});

const TRIAL_WARNING_DAYS = 3;

const banner = computed(() => {
  const value = status.value;
  if (!value) return null;

  const invoice = value.openInvoice
    ? `${formatCurrency(value.openInvoice.total, value.openInvoice.currency)} (${value.openInvoice.number})`
    : '';

  if (value.standing === 'restricted') {
    return {
      type: 'error' as const,
      text: invoice
        ? `توقف الاشتراك. المساعد الذكي وإضافة البيانات متوقفان حتى دفع ${invoice}.`
        : 'توقف الاشتراك. المساعد الذكي وإضافة البيانات متوقفان حتى تجديده.',
    };
  }
  if (value.status === 'PAST_DUE') {
    return {
      type: 'warning' as const,
      text: `فاتورة الاشتراك ${invoice} متأخرة. ادفعها قبل انتهاء فترة السماح ليستمر المتجر دون انقطاع.`,
    };
  }
  if (
    value.status === 'TRIALING' &&
    value.daysLeft !== null &&
    value.daysLeft <= TRIAL_WARNING_DAYS
  ) {
    return {
      type: 'info' as const,
      text:
        value.daysLeft === 0
          ? 'تنتهي الفترة التجريبية اليوم.'
          : `تنتهي الفترة التجريبية خلال ${value.daysLeft} ${value.daysLeft === 1 ? 'يوم' : 'أيام'} (${formatDate(value.periodEnd)}).`,
    };
  }
  return null;
});
</script>

<template>
  <v-alert v-if="banner" :type="banner.type" variant="tonal" density="compact" class="mb-4">
    <div class="d-flex flex-wrap align-center ga-2">
      <span class="flex-grow-1">{{ banner.text }}</span>
      <v-btn
        v-if="auth.can(PERMISSIONS.BILLING_READ)"
        size="small"
        variant="flat"
        :color="banner.type"
        :to="{ name: 'billing' }"
      >
        الاشتراك
      </v-btn>
    </div>
  </v-alert>
</template>
