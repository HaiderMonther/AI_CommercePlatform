<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ChannelBadges from '@/components/data/ChannelBadges.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import StatCard from '@/components/data/StatCard.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import CustomerFormDialog from './components/CustomerFormDialog.vue';
import StartConversationDialog from '@/views/conversations/components/StartConversationDialog.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import {
  CHANNEL_COLORS,
  CHANNEL_ICONS,
  CHANNEL_LABELS,
  CONVERSATION_MODE_LABELS,
  CONVERSATION_STATUS_COLORS,
  CONVERSATION_STATUS_LABELS,
  CUSTOMER_STATUS_COLORS,
  CUSTOMER_STATUS_LABELS,
} from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { customersService } from '@/services/crm.service';
import { useAuthStore } from '@/stores/auth.store';
import type { CustomerDetail } from '@/types/crm';
import { formatCurrency, formatDate, formatNumber, formatRelative } from '@/utils/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const customerId = computed(() => String(route.params.id));

const { data: customer, loading, error, execute } = useAsyncData<CustomerDetail | null>(
  () => customersService.get(customerId.value),
  null,
);

watch(customerId, execute, { immediate: true });

const editOpen = ref(false);
const startOpen = ref(false);

const canUpdate = computed(() => auth.can(PERMISSIONS.CUSTOMERS_UPDATE));
const canReply = computed(() => auth.can(PERMISSIONS.CONVERSATIONS_REPLY));
const canReadConversations = computed(() => auth.can(PERMISSIONS.CONVERSATIONS_READ));

const contactRows = computed(() => {
  const value = customer.value;
  if (!value) return [];

  return [
    { icon: 'mdi-phone-outline', label: 'الهاتف', value: value.phone, ltr: true },
    { icon: 'mdi-phone-plus-outline', label: 'رقم بديل', value: value.altPhone, ltr: true },
    { icon: 'mdi-email-outline', label: 'البريد', value: value.email, ltr: true },
    { icon: 'mdi-city-variant-outline', label: 'المدينة', value: value.city, ltr: false },
    { icon: 'mdi-map-marker-outline', label: 'العنوان', value: value.address, ltr: false },
    { icon: 'mdi-calendar-outline', label: 'أُضيف في', value: formatDate(value.createdAt), ltr: false },
  ];
});

function openConversation(id: string): void {
  router.push({ name: 'conversations', params: { id } });
}
</script>

<template>
  <div>
    <v-btn
      variant="text"
      prepend-icon="mdi-arrow-right"
      class="mb-2 px-1"
      :to="{ name: 'customers' }"
    >
      الزبائن
    </v-btn>

    <ErrorState
      v-if="error"
      :message="error.message"
      :correlation-id="error.correlationId"
      @retry="execute"
    />

    <v-skeleton-loader v-else-if="loading && !customer" type="heading, card, card" />

    <template v-else-if="customer">
      <PageHeader :title="customer.name">
        <template #actions>
          <v-chip :color="CUSTOMER_STATUS_COLORS[customer.status]" variant="tonal">
            {{ CUSTOMER_STATUS_LABELS[customer.status] }}
          </v-chip>
          <v-btn
            v-if="canUpdate"
            variant="tonal"
            prepend-icon="mdi-pencil-outline"
            @click="editOpen = true"
          >
            تعديل
          </v-btn>
          <v-btn
            v-if="canReply && customer.status === 'ACTIVE'"
            color="primary"
            prepend-icon="mdi-message-plus-outline"
            @click="startOpen = true"
          >
            محادثة جديدة
          </v-btn>
        </template>
      </PageHeader>

      <v-row>
        <v-col cols="12" sm="4">
          <StatCard
            title="الطلبات"
            :value="formatNumber(customer.totalOrders)"
            icon="mdi-cart-outline"
          />
        </v-col>
        <v-col cols="12" sm="4">
          <StatCard
            title="إجمالي المشتريات"
            :value="formatCurrency(customer.totalSpent, auth.currency)"
            icon="mdi-cash-multiple"
            color="success"
          />
        </v-col>
        <v-col cols="12" sm="4">
          <StatCard
            title="ديون مستحقة"
            :value="formatCurrency(customer.outstandingDebt, auth.currency)"
            icon="mdi-cash-clock"
            :color="customer.outstandingDebt > 0 ? 'warning' : 'secondary'"
          />
        </v-col>
      </v-row>

      <v-row class="mt-1">
        <v-col cols="12" md="5">
          <v-card class="mb-4">
            <v-card-title class="text-subtitle-1 font-weight-bold">بيانات التواصل</v-card-title>
            <v-list density="compact">
              <v-list-item
                v-for="row in contactRows"
                :key="row.label"
                :prepend-icon="row.icon"
                :subtitle="row.label"
              >
                <v-list-item-title>
                  <bdi :dir="row.ltr && row.value ? 'ltr' : undefined">{{ row.value || '—' }}</bdi>
                </v-list-item-title>
              </v-list-item>
            </v-list>

            <div v-if="customer.tags.length" class="d-flex flex-wrap ga-2 px-4 pb-4">
              <v-chip v-for="tag in customer.tags" :key="tag" size="small" variant="outlined">
                {{ tag }}
              </v-chip>
            </div>
          </v-card>

          <v-card class="mb-4">
            <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
              الحسابات على القنوات
              <v-spacer />
              <ChannelBadges :channels="customer.channels" />
            </v-card-title>
            <v-list v-if="customer.identities.length" density="compact">
              <v-list-item
                v-for="identity in customer.identities"
                :key="identity.id"
                :title="identity.displayName ?? CHANNEL_LABELS[identity.channel]"
                :subtitle="identity.platformUserId"
              >
                <template #prepend>
                  <v-icon
                    :icon="CHANNEL_ICONS[identity.channel]"
                    :color="CHANNEL_COLORS[identity.channel]"
                  />
                </template>
              </v-list-item>
            </v-list>
            <v-card-text v-else class="text-body-2 text-medium-emphasis pt-0">
              لم يراسل المتجر من أي قناة بعد. تُربط الحسابات تلقائياً عند أول رسالة.
            </v-card-text>
          </v-card>

          <v-card v-if="customer.notes">
            <v-card-title class="text-subtitle-1 font-weight-bold">ملاحظات داخلية</v-card-title>
            <v-card-text class="text-body-2 notes">{{ customer.notes }}</v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="7">
          <v-card>
            <v-card-title class="text-subtitle-1 font-weight-bold">آخر المحادثات</v-card-title>

            <v-list v-if="customer.recentConversations.length" lines="two">
              <v-list-item
                v-for="conversation in customer.recentConversations"
                :key="conversation.id"
                :disabled="!canReadConversations"
                @click="openConversation(conversation.id)"
              >
                <template #prepend>
                  <v-avatar :color="CHANNEL_COLORS[conversation.channel]" variant="tonal">
                    <v-icon :icon="CHANNEL_ICONS[conversation.channel]" />
                  </v-avatar>
                </template>

                <v-list-item-title>
                  {{ CHANNEL_LABELS[conversation.channel] }}
                  <span class="text-medium-emphasis text-caption">
                    · {{ CONVERSATION_MODE_LABELS[conversation.mode] }}
                  </span>
                </v-list-item-title>
                <v-list-item-subtitle>
                  آخر رسالة {{ formatRelative(conversation.lastMessageAt ?? conversation.createdAt) }}
                </v-list-item-subtitle>

                <template #append>
                  <div class="d-flex align-center ga-2">
                    <v-badge
                      v-if="conversation.unreadCount"
                      :content="conversation.unreadCount"
                      color="error"
                      inline
                    />
                    <v-chip
                      :color="CONVERSATION_STATUS_COLORS[conversation.status]"
                      size="small"
                      variant="tonal"
                    >
                      {{ CONVERSATION_STATUS_LABELS[conversation.status] }}
                    </v-chip>
                  </div>
                </template>
              </v-list-item>
            </v-list>

            <v-card-text v-else class="text-body-2 text-medium-emphasis">
              لا توجد محادثات مع هذا الزبون بعد.
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <CustomerFormDialog v-model="editOpen" :customer="customer" @saved="execute" />
      <StartConversationDialog v-model="startOpen" :customer="customer" />
    </template>
  </div>
</template>

<style scoped>
.notes {
  white-space: pre-line;
}
</style>
