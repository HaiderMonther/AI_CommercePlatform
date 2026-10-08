<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useDisplay } from 'vuetify';
import ErrorState from '@/components/data/ErrorState.vue';
import CustomerPanel from './CustomerPanel.vue';
import { useRealtimeEvent } from '@/composables/useRealtime';
import {
  CHANNEL_COLORS,
  CHANNEL_ICONS,
  CHANNEL_LABELS,
  CONVERSATION_STATUS_COLORS,
  CONVERSATION_STATUS_LABELS,
  DELIVERY_STATUS_ICONS,
  DELIVERY_STATUS_LABELS,
} from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { conversationsService } from '@/services/crm.service';
import { REALTIME_EVENT, joinConversation, leaveConversation } from '@/services/realtime';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type {
  Conversation,
  ConversationDetail,
  ConversationStatus,
  Message,
} from '@/types/crm';
import { appendMessage, dayKey, prependMessages } from '@/utils/conversations';
import { formatDate, formatTime } from '@/utils/format';

const props = defineProps<{
  conversationId: string;
  assignees: { id: string; fullName: string }[];
  showBack: boolean;
}>();

defineEmits<{ back: [] }>();

const auth = useAuthStore();
const ui = useUiStore();
const { lgAndUp } = useDisplay();

const detail = ref<ConversationDetail | null>(null);
const messages = ref<Message[]>([]);
const hasMore = ref(false);
const nextBefore = ref<string | null>(null);
const loading = ref(false);
const loadingOlder = ref(false);
const loadError = ref<ApiError | null>(null);
const acting = ref(false);
const draft = ref('');
const sending = ref(false);
const panelOpen = ref(false);
const scroller = ref<HTMLElement | null>(null);

const canReply = computed(() => auth.can(PERMISSIONS.CONVERSATIONS_REPLY));
const canAssign = computed(() => auth.can(PERMISSIONS.CONVERSATIONS_ASSIGN));
const canClose = computed(() => auth.can(PERMISSIONS.CONVERSATIONS_CLOSE));
const blocked = computed(() => detail.value?.customer.status === 'BLOCKED');

const statusOptions = Object.entries(CONVERSATION_STATUS_LABELS).map(([value, title]) => ({
  value: value as ConversationStatus,
  title,
}));

/** Messages with a date separator wherever the calendar day changes. */
const timeline = computed(() =>
  messages.value.map((message, index) => ({
    message,
    separator:
      index === 0 || dayKey(messages.value[index - 1].createdAt) !== dayKey(message.createdAt)
        ? formatDate(message.createdAt)
        : null,
  })),
);

function isNearBottom(): boolean {
  const element = scroller.value;
  return !element || element.scrollHeight - element.scrollTop - element.clientHeight < 120;
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (scroller.value) {
    scroller.value.scrollTop = scroller.value.scrollHeight;
  }
}

let markReadTimer: number | undefined;

/** Debounced so a burst of customer messages costs one request, not one each. */
function scheduleMarkRead(): void {
  if (document.visibilityState !== 'visible') return;

  window.clearTimeout(markReadTimer);
  const id = props.conversationId;
  markReadTimer = window.setTimeout(() => {
    conversationsService.markRead(id).catch(() => undefined);
  }, 800);
}

async function load(id: string): Promise<void> {
  loading.value = true;
  loadError.value = null;
  detail.value = null;
  messages.value = [];
  draft.value = '';

  try {
    const [conversation, page] = await Promise.all([
      conversationsService.get(id),
      conversationsService.messages(id),
    ]);

    // The user may have clicked another conversation while this one was loading.
    if (id !== props.conversationId) return;

    detail.value = conversation;
    messages.value = page.items;
    hasMore.value = page.hasMore;
    nextBefore.value = page.nextBefore;

    await scrollToBottom();
    if (conversation.unreadCount > 0) scheduleMarkRead();
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

async function loadOlder(): Promise<void> {
  if (!nextBefore.value || loadingOlder.value) return;

  loadingOlder.value = true;
  const previousHeight = scroller.value?.scrollHeight ?? 0;

  try {
    const page = await conversationsService.messages(props.conversationId, {
      before: nextBefore.value,
    });
    messages.value = prependMessages(messages.value, page.items);
    hasMore.value = page.hasMore;
    nextBefore.value = page.nextBefore;

    // Keep the message the user was reading in place instead of jumping to the top.
    await nextTick();
    if (scroller.value) {
      scroller.value.scrollTop += scroller.value.scrollHeight - previousHeight;
    }
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر تحميل الرسائل السابقة');
  } finally {
    loadingOlder.value = false;
  }
}

watch(
  () => props.conversationId,
  (id, previous) => {
    if (previous) leaveConversation(previous);
    joinConversation(id);
    load(id);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  leaveConversation(props.conversationId);
  window.clearTimeout(markReadTimer);
});

useRealtimeEvent<{ conversationId: string; message: Message }>(
  REALTIME_EVENT.MESSAGE_CREATED,
  ({ conversationId, message }) => {
    if (conversationId !== props.conversationId) return;

    const follow = isNearBottom();
    messages.value = appendMessage(messages.value, message);
    if (follow) scrollToBottom();
  },
);

useRealtimeEvent<Conversation>(REALTIME_EVENT.CONVERSATION_UPDATED, (conversation) => {
  if (!detail.value || conversation.id !== props.conversationId) return;

  // The inbox row carries a short customer; keep the full profile already loaded.
  detail.value = {
    ...detail.value,
    status: conversation.status,
    mode: conversation.mode,
    subject: conversation.subject,
    unreadCount: conversation.unreadCount,
    assignedUser: conversation.assignedUser,
    handoverReason: conversation.handoverReason,
    handoverAt: conversation.handoverAt,
    lastMessageAt: conversation.lastMessageAt,
    closedAt: conversation.closedAt,
  };

  if (conversation.unreadCount > 0) scheduleMarkRead();
});

async function send(): Promise<void> {
  const content = draft.value.trim();
  if (!content || sending.value) return;

  sending.value = true;
  try {
    const message = await conversationsService.send(props.conversationId, content);
    messages.value = appendMessage(messages.value, message);
    draft.value = '';
    await scrollToBottom();
    // A reply can change mode, status and assignee; do not depend on the socket for it.
    detail.value = await conversationsService.get(props.conversationId);
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر إرسال الرسالة');
  } finally {
    sending.value = false;
  }
}

function onComposerKeydown(event: KeyboardEvent): void {
  // Enter sends, Shift+Enter breaks the line; IME composition must not send mid-word.
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

async function act(action: () => Promise<ConversationDetail>, success: string): Promise<void> {
  acting.value = true;
  try {
    detail.value = await action();
    ui.success(success);
  } catch (error) {
    ui.error(error instanceof ApiError ? error.message : 'تعذر تنفيذ العملية');
  } finally {
    acting.value = false;
  }
}

const toggleMode = () =>
  detail.value?.mode === 'AI'
    ? act(() => conversationsService.setMode(props.conversationId, 'HUMAN'), 'توليت المحادثة، توقف الرد الآلي')
    : act(() => conversationsService.setMode(props.conversationId, 'AI'), 'أُعيدت المحادثة للمساعد الذكي');

const setStatus = (status: ConversationStatus) =>
  act(() => conversationsService.setStatus(props.conversationId, status), 'تم تحديث حالة المحادثة');

const assign = (userId: string | null) =>
  act(
    () => conversationsService.assign(props.conversationId, userId),
    userId ? 'تم إسناد المحادثة' : 'تم إلغاء الإسناد',
  );

function bubbleColor(message: Message): string | undefined {
  if (message.direction === 'INBOUND') return undefined;
  return message.senderType === 'AI' ? 'secondary' : 'primary';
}
</script>

<template>
  <div class="thread-shell">
    <div class="thread-main">
      <ErrorState
        v-if="loadError"
        :message="loadError.message"
        :correlation-id="loadError.correlationId"
        @retry="load(conversationId)"
      />

      <div v-else-if="loading || !detail" class="pa-6">
        <v-skeleton-loader type="list-item-avatar, divider, paragraph, paragraph" />
      </div>

      <template v-else>
        <!-- Header -->
        <div class="d-flex align-center flex-wrap ga-2 px-3 py-2 border-b">
          <v-btn v-if="showBack" icon="mdi-arrow-right" variant="text" size="small" @click="$emit('back')" />

          <v-avatar :color="CHANNEL_COLORS[detail.channel]" variant="tonal" size="38">
            <v-icon :icon="CHANNEL_ICONS[detail.channel]" />
          </v-avatar>

          <div class="min-w-0 flex-grow-1">
            <div class="text-subtitle-2 font-weight-bold text-truncate">{{ detail.customer.name }}</div>
            <div class="text-caption text-medium-emphasis text-truncate">
              {{ CHANNEL_LABELS[detail.channel] }}
              <template v-if="detail.subject"> · {{ detail.subject }}</template>
              <template v-if="detail.assignedUser"> · {{ detail.assignedUser.fullName }}</template>
            </div>
          </div>

          <v-btn
            v-if="canReply"
            :color="detail.mode === 'AI' ? 'warning' : 'secondary'"
            variant="tonal"
            size="small"
            :loading="acting"
            :prepend-icon="detail.mode === 'AI' ? 'mdi-account-tie-outline' : 'mdi-robot-outline'"
            @click="toggleMode"
          >
            {{ detail.mode === 'AI' ? 'تولّي المحادثة' : 'إعادة للمساعد' }}
          </v-btn>

          <v-menu v-if="canClose" location="bottom end">
            <template #activator="{ props: menuProps }">
              <v-chip
                v-bind="menuProps"
                :color="CONVERSATION_STATUS_COLORS[detail.status]"
                variant="tonal"
                append-icon="mdi-chevron-down"
                :disabled="acting"
              >
                {{ CONVERSATION_STATUS_LABELS[detail.status] }}
              </v-chip>
            </template>
            <v-list density="compact">
              <v-list-item
                v-for="option in statusOptions"
                :key="option.value"
                :title="option.title"
                :active="option.value === detail.status"
                @click="setStatus(option.value)"
              />
            </v-list>
          </v-menu>
          <v-chip v-else :color="CONVERSATION_STATUS_COLORS[detail.status]" variant="tonal">
            {{ CONVERSATION_STATUS_LABELS[detail.status] }}
          </v-chip>

          <v-menu v-if="canAssign && assignees.length" location="bottom end">
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                icon="mdi-account-arrow-left-outline"
                variant="text"
                size="small"
                title="إسناد"
                :disabled="acting"
              />
            </template>
            <v-list density="compact" max-height="320">
              <v-list-subheader>إسناد إلى</v-list-subheader>
              <v-list-item
                v-for="user in assignees"
                :key="user.id"
                :title="user.fullName"
                :active="detail.assignedUser?.id === user.id"
                @click="assign(user.id)"
              />
              <v-divider />
              <v-list-item
                title="إلغاء الإسناد"
                prepend-icon="mdi-account-remove-outline"
                :disabled="!detail.assignedUser"
                @click="assign(null)"
              />
            </v-list>
          </v-menu>

          <v-btn
            v-if="!lgAndUp"
            icon="mdi-account-details-outline"
            variant="text"
            size="small"
            title="ملف الزبون"
            @click="panelOpen = true"
          />
        </div>

        <!-- Messages -->
        <div ref="scroller" class="thread-messages px-3 py-4">
          <div v-if="hasMore" class="text-center mb-3">
            <v-btn size="small" variant="tonal" :loading="loadingOlder" @click="loadOlder">
              تحميل الرسائل الأقدم
            </v-btn>
          </div>

          <div v-if="!messages.length" class="text-center text-medium-emphasis text-body-2 py-10">
            لا توجد رسائل بعد. اكتب أول رسالة للزبون.
          </div>

          <template v-for="{ message, separator } in timeline" :key="message.id">
            <div v-if="separator" class="d-flex justify-center my-3">
              <v-chip size="x-small" variant="tonal">{{ separator }}</v-chip>
            </div>

            <div v-if="message.senderType === 'SYSTEM'" class="text-center text-caption text-medium-emphasis my-2">
              {{ message.content }}
            </div>

            <div
              v-else
              class="d-flex mb-2"
              :class="message.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'"
            >
              <v-sheet
                :color="bubbleColor(message)"
                :class="message.direction === 'OUTBOUND' ? 'bubble bubble-out' : 'bubble bubble-in'"
                rounded="lg"
                class="px-3 py-2"
              >
                <div v-if="message.direction === 'OUTBOUND'" class="text-caption font-weight-medium mb-1 bubble-meta">
                  <v-icon
                    :icon="message.senderType === 'AI' ? 'mdi-robot-outline' : 'mdi-account-tie-outline'"
                    size="14"
                  />
                  {{ message.senderType === 'AI' ? 'المساعد الذكي' : (message.senderUser?.fullName ?? 'موظف') }}
                </div>

                <div class="text-body-2 bubble-text">{{ message.content }}</div>

                <div class="d-flex align-center justify-end ga-1 mt-1 text-caption bubble-meta">
                  <span class="numeric">{{ formatTime(message.createdAt) }}</span>
                  <v-icon
                    v-if="message.direction === 'OUTBOUND'"
                    :icon="DELIVERY_STATUS_ICONS[message.deliveryStatus]"
                    :color="message.deliveryStatus === 'FAILED' ? 'error' : undefined"
                    :title="message.failureReason ?? DELIVERY_STATUS_LABELS[message.deliveryStatus]"
                    size="14"
                  />
                </div>
              </v-sheet>
            </div>
          </template>
        </div>

        <!-- Composer -->
        <div class="border-t pa-3">
          <v-alert v-if="blocked" type="error" variant="tonal" density="compact">
            الزبون محظور. ألغِ الحظر من ملفه لتتمكن من الرد.
          </v-alert>

          <div v-else-if="!canReply" class="text-caption text-medium-emphasis text-center">
            لديك صلاحية العرض فقط في هذه المحادثة.
          </div>

          <template v-else>
            <div v-if="detail.mode === 'AI'" class="text-caption text-medium-emphasis mb-2">
              <v-icon icon="mdi-robot-outline" size="14" />
              المساعد الذكي يرد على هذه المحادثة، وردّك سيحوّلها إليك ويوقف الرد الآلي.
            </div>

            <div class="d-flex align-end ga-2">
              <v-textarea
                v-model="draft"
                placeholder="اكتب ردك… (Enter للإرسال، Shift+Enter لسطر جديد)"
                rows="1"
                max-rows="6"
                auto-grow
                hide-details
                counter="4096"
                maxlength="4096"
                :disabled="sending"
                @keydown="onComposerKeydown"
              />
              <v-btn
                color="primary"
                icon="mdi-send"
                :loading="sending"
                :disabled="!draft.trim()"
                title="إرسال"
                class="send-btn"
                @click="send"
              />
            </div>
          </template>
        </div>
      </template>
    </div>

    <aside v-if="lgAndUp && detail" class="thread-panel border-s">
      <CustomerPanel :customer="detail.customer" />
    </aside>

    <v-dialog v-if="detail" v-model="panelOpen" max-width="420">
      <v-card>
        <CustomerPanel :customer="detail.customer" />
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.thread-shell {
  display: flex;
  height: 100%;
  min-height: 0;
}

.thread-main {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.thread-messages {
  flex: 1 1 auto;
  overflow-y: auto;
  background: rgba(var(--v-theme-on-surface), 0.02);
}

.thread-panel {
  flex: 0 0 300px;
  overflow-y: auto;
}

.bubble {
  max-width: min(75%, 560px);
}

/* The theme defines no on-surface-variant, so text colour comes from on-surface. */
.bubble-in {
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.bubble-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.bubble-meta {
  opacity: 0.75;
}

.send-btn {
  flex-shrink: 0;
}

.min-w-0 {
  min-width: 0;
}
</style>
