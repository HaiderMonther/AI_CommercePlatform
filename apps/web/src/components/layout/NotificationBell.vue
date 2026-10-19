<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import { useRealtimeEvent } from '@/composables/useRealtime';
import { REALTIME_EVENT, realtimeStatus } from '@/services/realtime';
import { notificationsService } from '@/services/reports.service';
import { useUiStore } from '@/stores/ui.store';
import type { AppNotification, NotificationType } from '@/types/reports';
import { formatRelative } from '@/utils/format';

const router = useRouter();
const ui = useUiStore();

const open = ref(false);
const unread = ref(0);
const items = ref<AppNotification[]>([]);
const loading = ref(false);

const ICONS: Record<NotificationType, { icon: string; color: string }> = {
  NEW_ORDER: { icon: 'mdi-cart-plus', color: 'primary' },
  ORDER_STATUS_CHANGED: { icon: 'mdi-cart-arrow-right', color: 'primary' },
  NEW_CUSTOMER: { icon: 'mdi-account-plus-outline', color: 'secondary' },
  LOW_STOCK: { icon: 'mdi-package-variant-remove', color: 'warning' },
  NEW_CONVERSATION: { icon: 'mdi-message-plus-outline', color: 'info' },
  HUMAN_HANDOVER: { icon: 'mdi-account-switch-outline', color: 'warning' },
  CHANNEL_ERROR: { icon: 'mdi-lan-disconnect', color: 'error' },
  SYSTEM: { icon: 'mdi-information-outline', color: 'secondary' },
};

async function refreshCount(): Promise<void> {
  try {
    unread.value = (await notificationsService.unreadCount()).unread;
  } catch {
    // The badge catches up on the next event or reconnect.
  }
}

async function loadList(): Promise<void> {
  loading.value = true;
  try {
    const page = await notificationsService.list({ limit: 20 });
    items.value = page.items;
    unread.value = page.unread;
  } catch {
    ui.error('تعذّر تحميل الإشعارات');
  } finally {
    loading.value = false;
  }
}

onMounted(refreshCount);
watch(open, (value) => value && loadList());
// Events missed while offline are not replayed; re-read the count after reconnecting.
watch(realtimeStatus, (status) => status === 'connected' && refreshCount());

useRealtimeEvent<AppNotification>(REALTIME_EVENT.NOTIFICATION_CREATED, (notification) => {
  unread.value += 1;
  if (open.value) items.value = [notification, ...items.value].slice(0, 20);
});

function targetOf(notification: AppNotification): RouteLocationRaw | null {
  const data = notification.data ?? {};
  if (data.orderId) return { name: 'order-detail', params: { id: String(data.orderId) } };
  if (data.conversationId)
    return { name: 'conversations', params: { id: String(data.conversationId) } };
  if (data.productId) return { name: 'inventory' };
  if (data.channelId) return { name: 'channels' };
  return null;
}

async function select(notification: AppNotification): Promise<void> {
  if (!notification.readAt) {
    notification.readAt = new Date().toISOString();
    notificationsService
      .markRead(notification.id)
      .then((result) => (unread.value = result.unread))
      .catch(() => undefined);
  }

  const target = targetOf(notification);
  open.value = false;
  if (target) await router.push(target);
}

async function markAll(): Promise<void> {
  await notificationsService.markAllRead();
  unread.value = 0;
  items.value = items.value.map((item) => ({
    ...item,
    readAt: item.readAt ?? new Date().toISOString(),
  }));
}
</script>

<template>
  <v-menu v-model="open" location="bottom end" :close-on-content-click="false" max-width="380">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon variant="text" :aria-label="`الإشعارات، ${unread} غير مقروءة`">
        <v-badge v-if="unread" :content="unread > 99 ? '99+' : unread" color="error" floating>
          <v-icon icon="mdi-bell-outline" />
        </v-badge>
        <v-icon v-else icon="mdi-bell-outline" />
      </v-btn>
    </template>

    <v-card min-width="340">
      <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
        الإشعارات
        <v-spacer />
        <v-btn v-if="unread" size="small" variant="text" @click="markAll">تعليم الكل كمقروء</v-btn>
      </v-card-title>
      <v-divider />

      <v-progress-linear v-if="loading" indeterminate color="primary" />

      <v-list
        v-if="items.length"
        lines="two"
        max-height="420"
        class="py-0"
        style="overflow-y: auto"
      >
        <v-list-item
          v-for="notification in items"
          :key="notification.id"
          :class="{ unread: !notification.readAt }"
          @click="select(notification)"
        >
          <template #prepend>
            <v-avatar :color="ICONS[notification.type].color" variant="tonal" size="36">
              <v-icon :icon="ICONS[notification.type].icon" size="20" />
            </v-avatar>
          </template>
          <v-list-item-title class="text-body-2 font-weight-medium">
{{
            notification.title
          }}
</v-list-item-title>
          <v-list-item-subtitle>{{ notification.body }}</v-list-item-subtitle>
          <template #append>
            <div class="d-flex flex-column align-end ga-1">
              <span class="text-caption text-medium-emphasis">{{
                formatRelative(notification.createdAt)
              }}</span>
              <v-icon
                v-if="!notification.readAt"
                icon="mdi-circle"
                size="8"
                color="primary"
                aria-label="غير مقروء"
              />
            </div>
          </template>
        </v-list-item>
      </v-list>

      <v-card-text v-else-if="!loading" class="text-body-2 text-medium-emphasis text-center py-8">
        لا توجد إشعارات
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped>
.unread {
  background: rgba(var(--v-theme-primary), 0.05);
}
</style>
