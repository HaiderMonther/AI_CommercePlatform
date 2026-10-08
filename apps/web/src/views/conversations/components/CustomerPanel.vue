<script setup lang="ts">
import { computed } from 'vue';
import ChannelBadges from '@/components/data/ChannelBadges.vue';
import { CUSTOMER_STATUS_COLORS, CUSTOMER_STATUS_LABELS } from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { useAuthStore } from '@/stores/auth.store';
import type { ChannelType, ConversationDetail } from '@/types/crm';
import { formatCurrency, formatDate, formatNumber, initialsOf } from '@/utils/format';

const props = defineProps<{ customer: ConversationDetail['customer'] }>();

const auth = useAuthStore();

const channels = computed(
  () => [...new Set(props.customer.identities.map((identity) => identity.channel))] as ChannelType[],
);

const rows = computed(() =>
  [
    { icon: 'mdi-phone-outline', value: props.customer.phone, ltr: true },
    { icon: 'mdi-phone-plus-outline', value: props.customer.altPhone, ltr: true },
    { icon: 'mdi-email-outline', value: props.customer.email, ltr: true },
    { icon: 'mdi-city-variant-outline', value: props.customer.city, ltr: false },
    { icon: 'mdi-map-marker-outline', value: props.customer.address, ltr: false },
  ].filter((row) => row.value),
);
</script>

<template>
  <div class="pa-4">
    <div class="text-center mb-4">
      <v-avatar color="primary" variant="tonal" size="64" class="mb-2">
        <span class="text-h6 font-weight-bold">{{ initialsOf(customer.name) }}</span>
      </v-avatar>
      <div class="text-subtitle-1 font-weight-bold">{{ customer.name }}</div>
      <div class="d-flex justify-center align-center ga-2 mt-1">
        <ChannelBadges :channels="channels" />
        <v-chip
          v-if="customer.status !== 'ACTIVE'"
          :color="CUSTOMER_STATUS_COLORS[customer.status]"
          size="x-small"
          variant="tonal"
        >
          {{ CUSTOMER_STATUS_LABELS[customer.status] }}
        </v-chip>
      </div>
    </div>

    <v-row dense class="mb-3">
      <v-col cols="6">
        <v-sheet rounded="lg" border class="pa-2 text-center">
          <div class="text-caption text-medium-emphasis">الطلبات</div>
          <div class="text-subtitle-2 font-weight-bold numeric">
            {{ formatNumber(customer.totalOrders) }}
          </div>
        </v-sheet>
      </v-col>
      <v-col cols="6">
        <v-sheet rounded="lg" border class="pa-2 text-center">
          <div class="text-caption text-medium-emphasis">المشتريات</div>
          <div class="text-subtitle-2 font-weight-bold numeric">
            {{ formatCurrency(customer.totalSpent, auth.currency) }}
          </div>
        </v-sheet>
      </v-col>
    </v-row>

    <v-list density="compact" class="pa-0">
      <v-list-item v-for="row in rows" :key="row.icon" :prepend-icon="row.icon" class="px-0">
        <v-list-item-title class="text-body-2">
          <bdi :dir="row.ltr ? 'ltr' : undefined">{{ row.value }}</bdi>
        </v-list-item-title>
      </v-list-item>
      <v-list-item
        v-if="customer.lastOrderAt"
        prepend-icon="mdi-cart-check"
        class="px-0"
        :title="`آخر طلب ${formatDate(customer.lastOrderAt)}`"
      />
    </v-list>

    <div v-if="customer.tags.length" class="d-flex flex-wrap ga-1 mt-3">
      <v-chip v-for="tag in customer.tags" :key="tag" size="x-small" variant="outlined">
        {{ tag }}
      </v-chip>
    </div>

    <v-alert
      v-if="customer.notes"
      density="compact"
      variant="tonal"
      color="info"
      icon="mdi-note-text-outline"
      class="mt-4 text-body-2 notes"
    >
      {{ customer.notes }}
    </v-alert>

    <v-btn
      v-if="auth.can(PERMISSIONS.CUSTOMERS_READ)"
      block
      variant="tonal"
      class="mt-4"
      prepend-icon="mdi-account-details-outline"
      :to="{ name: 'customer-detail', params: { id: customer.id } }"
    >
      الملف الكامل
    </v-btn>
  </div>
</template>

<style scoped>
.notes {
  white-space: pre-line;
}
</style>
