<script setup lang="ts">
import { CHANNEL_COLORS, CHANNEL_ICONS, CONVERSATION_STATUS_COLORS, CONVERSATION_STATUS_LABELS } from '@/constants/labels';
import { useAuthStore } from '@/stores/auth.store';
import type { Conversation } from '@/types/crm';
import { formatRelative, initialsOf } from '@/utils/format';

defineProps<{
  items: Conversation[];
  selectedId: string | null;
  loading: boolean;
  hasMore: boolean;
}>();

defineEmits<{ select: [id: string]; 'load-more': [] }>();

const auth = useAuthStore();

const PREVIEW_PREFIX: Record<string, string> = { AI: '🤖 ', AGENT: 'موظف: ', SYSTEM: '' };

function preview(conversation: Conversation): string {
  const message = conversation.lastMessage;
  if (!message) return conversation.subject ?? 'لا توجد رسائل بعد';

  const prefix =
    message.senderType === 'AGENT' && message.senderUserId === auth.user?.id
      ? 'أنت: '
      : (PREVIEW_PREFIX[message.senderType] ?? '');
  return `${prefix}${message.content}`;
}
</script>

<template>
  <div class="conversation-list">
    <v-list v-if="items.length" lines="two" class="py-0">
      <template v-for="conversation in items" :key="conversation.id">
        <v-list-item
          :active="conversation.id === selectedId"
          color="primary"
          class="py-3"
          @click="$emit('select', conversation.id)"
        >
          <template #prepend>
            <v-badge
              :icon="CHANNEL_ICONS[conversation.channel]"
              :color="CHANNEL_COLORS[conversation.channel]"
              location="bottom end"
              offset-x="4"
              offset-y="4"
            >
              <v-avatar color="primary" variant="tonal" size="42">
                <span class="text-caption font-weight-bold">
                  {{ initialsOf(conversation.customer.name) }}
                </span>
              </v-avatar>
            </v-badge>
          </template>

          <div class="d-flex align-center ga-2">
            <span
              class="text-body-2 text-truncate flex-grow-1"
              :class="conversation.unreadCount ? 'font-weight-bold' : 'font-weight-medium'"
            >
              {{ conversation.customer.name }}
            </span>
            <span class="text-caption text-medium-emphasis flex-shrink-0">
              {{ formatRelative(conversation.lastMessageAt ?? conversation.createdAt) }}
            </span>
          </div>

          <div class="d-flex align-center ga-2 mt-1">
            <span
              class="text-caption text-truncate flex-grow-1"
              :class="conversation.unreadCount ? 'text-high-emphasis' : 'text-medium-emphasis'"
            >
              {{ preview(conversation) }}
            </span>
            <v-badge
              v-if="conversation.unreadCount"
              :content="conversation.unreadCount"
              color="error"
              inline
              class="flex-shrink-0"
            />
          </div>

          <div class="d-flex align-center flex-wrap ga-1 mt-2">
            <v-chip
              v-if="conversation.mode === 'HUMAN'"
              size="x-small"
              color="warning"
              variant="tonal"
              prepend-icon="mdi-account-tie-outline"
            >
              {{ conversation.assignedUser?.fullName ?? 'بانتظار موظف' }}
            </v-chip>
            <v-chip v-else size="x-small" color="secondary" variant="tonal" prepend-icon="mdi-robot-outline">
              المساعد الذكي
            </v-chip>
            <v-chip
              v-if="conversation.status !== 'OPEN'"
              size="x-small"
              :color="CONVERSATION_STATUS_COLORS[conversation.status]"
              variant="outlined"
            >
              {{ CONVERSATION_STATUS_LABELS[conversation.status] }}
            </v-chip>
          </div>
        </v-list-item>
        <v-divider />
      </template>
    </v-list>

    <div v-if="loading" class="pa-4">
      <v-skeleton-loader v-for="index in 4" :key="index" type="list-item-avatar-two-line" />
    </div>

    <div v-else-if="!items.length" class="text-center pa-8 text-medium-emphasis">
      <v-icon icon="mdi-forum-outline" size="44" class="mb-2" />
      <div class="text-body-2">لا توجد محادثات هنا</div>
    </div>

    <div v-else-if="hasMore" class="pa-3 text-center">
      <v-btn variant="text" size="small" @click="$emit('load-more')">تحميل المزيد</v-btn>
    </div>
  </div>
</template>

<style scoped>
.conversation-list {
  overflow-y: auto;
  height: 100%;
}
</style>
