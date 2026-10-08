<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import ErrorState from '@/components/data/ErrorState.vue';
import ConversationList from './components/ConversationList.vue';
import ConversationThread from './components/ConversationThread.vue';
import StartConversationDialog from './components/StartConversationDialog.vue';
import { useRealtimeEvent } from '@/composables/useRealtime';
import { CHANNEL_LABELS } from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { conversationsService, type ConversationsQuery } from '@/services/crm.service';
import { REALTIME_EVENT, realtimeStatus } from '@/services/realtime';
import { usersService } from '@/services/users.service';
import { useAuthStore } from '@/stores/auth.store';
import { ApiError } from '@/types/api';
import type { ChannelType, Conversation, ConversationStats } from '@/types/crm';
import { upsertConversation } from '@/utils/conversations';

type TabKey = 'active' | 'mine' | 'unassigned' | 'human' | 'all';

interface TabDefinition {
  key: TabKey;
  title: string;
  query: ConversationsQuery;
  count: (stats: ConversationStats) => number | null;
  matches: (conversation: Conversation) => boolean;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { mdAndUp } = useDisplay();

const isActive = (conversation: Conversation) =>
  conversation.status === 'OPEN' || conversation.status === 'PENDING';

const tabs: TabDefinition[] = [
  {
    key: 'active',
    title: 'النشطة',
    query: { active: true },
    count: (stats) => stats.active,
    matches: isActive,
  },
  {
    key: 'mine',
    title: 'المسندة لي',
    query: { active: true, assignee: 'me' },
    count: (stats) => stats.mine,
    matches: (c) => isActive(c) && c.assignedUser?.id === auth.user?.id,
  },
  {
    key: 'unassigned',
    title: 'غير المسندة',
    query: { active: true, assignee: 'unassigned' },
    count: (stats) => stats.unassigned,
    matches: (c) => isActive(c) && !c.assignedUser,
  },
  {
    key: 'human',
    title: 'بانتظار موظف',
    query: { active: true, mode: 'HUMAN' },
    count: (stats) => stats.human,
    matches: (c) => isActive(c) && c.mode === 'HUMAN',
  },
  { key: 'all', title: 'الكل', query: {}, count: () => null, matches: () => true },
];

const PAGE_SIZE = 25;

const tab = ref<TabKey>('active');
const search = ref('');
const channel = ref<ChannelType | null>(null);
const unreadOnly = ref(false);

const conversations = ref<Conversation[]>([]);
const page = ref(1);
const hasMore = ref(false);
const loading = ref(false);
const loadError = ref<ApiError | null>(null);
const stats = ref<ConversationStats | null>(null);
const assignees = ref<{ id: string; fullName: string }[]>([]);
const startOpen = ref(false);

const selectedId = computed(() => (route.params.id ? String(route.params.id) : null));
const activeTab = computed(() => tabs.find((item) => item.key === tab.value)!);
const canReply = computed(() => auth.can(PERMISSIONS.CONVERSATIONS_REPLY));

const channelOptions = Object.entries(CHANNEL_LABELS).map(([value, title]) => ({ value, title }));

/** Whether a pushed update belongs in the list the user is looking at. */
function matchesView(conversation: Conversation): boolean {
  return (
    activeTab.value.matches(conversation) &&
    (!channel.value || conversation.channel === channel.value) &&
    (!unreadOnly.value || conversation.unreadCount > 0)
  );
}

async function load(reset = true): Promise<void> {
  if (reset) {
    page.value = 1;
  }

  loading.value = true;
  loadError.value = null;

  try {
    const result = await conversationsService.list({
      ...activeTab.value.query,
      page: page.value,
      limit: PAGE_SIZE,
      search: search.value || undefined,
      channel: channel.value ?? undefined,
      unread: unreadOnly.value || undefined,
    });

    conversations.value = reset ? result.items : [...conversations.value, ...result.items];
    hasMore.value = result.meta.hasNext;
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

function loadMore(): void {
  page.value += 1;
  load(false);
}

async function loadStats(): Promise<void> {
  try {
    stats.value = await conversationsService.stats();
  } catch {
    // Tab counters are decoration; the list still works without them.
  }
}

async function loadAssignees(): Promise<void> {
  if (!auth.can([PERMISSIONS.CONVERSATIONS_ASSIGN, PERMISSIONS.USERS_READ])) return;
  try {
    const result = await usersService.list({ status: 'ACTIVE', limit: 100 });
    assignees.value = result.items.map((user) => ({ id: user.id, fullName: user.fullName }));
  } catch {
    assignees.value = [];
  }
}

let statsTimer: number | undefined;

/** Counters change with every event; refetch them once per burst, not per event. */
function scheduleStats(): void {
  window.clearTimeout(statsTimer);
  statsTimer = window.setTimeout(loadStats, 1000);
}

useRealtimeEvent<Conversation>(REALTIME_EVENT.CONVERSATION_UPDATED, (conversation) => {
  // With a search active the server decides what matches; only refresh rows already shown.
  if (search.value && !conversations.value.some((item) => item.id === conversation.id)) {
    scheduleStats();
    return;
  }

  conversations.value = upsertConversation(conversations.value, conversation, matchesView);
  scheduleStats();
});

// After a reconnect, events missed while offline are gone: resync from the API.
watch(realtimeStatus, (status, previous) => {
  if (status === 'connected' && previous === 'offline') {
    load();
    loadStats();
  }
});

let searchTimer: number | undefined;

watch(search, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => load(), 350);
});

watch([tab, channel, unreadOnly], () => load());

onMounted(() => {
  load();
  loadStats();
  loadAssignees();
});

onBeforeUnmount(() => {
  window.clearTimeout(statsTimer);
  window.clearTimeout(searchTimer);
});

function select(id: string): void {
  router.push({ name: 'conversations', params: { id } });
}

function back(): void {
  router.push({ name: 'conversations' });
}
</script>

<template>
  <v-card class="inbox">
    <!-- List column: always on desktop, only without a selection on mobile. -->
    <section v-if="mdAndUp || !selectedId" class="inbox-list border-e">
      <div class="pa-3 pb-0">
        <div class="d-flex align-center ga-2 mb-3">
          <div class="text-subtitle-1 font-weight-bold flex-grow-1">المحادثات</div>
          <v-icon
            :icon="realtimeStatus === 'connected' ? 'mdi-circle' : 'mdi-circle-outline'"
            :color="realtimeStatus === 'connected' ? 'success' : 'warning'"
            size="10"
            :title="realtimeStatus === 'connected' ? 'التحديث المباشر يعمل' : 'التحديث المباشر غير متصل'"
          />
          <v-btn
            v-if="canReply"
            icon="mdi-message-plus-outline"
            variant="tonal"
            color="primary"
            size="small"
            title="محادثة جديدة"
            @click="startOpen = true"
          />
        </div>

        <v-text-field
          v-model="search"
          placeholder="ابحث باسم الزبون أو هاتفه"
          prepend-inner-icon="mdi-magnify"
          clearable
          hide-details
          density="compact"
          class="mb-2"
        />

        <div class="d-flex align-center ga-2">
          <v-select
            v-model="channel"
            :items="channelOptions"
            placeholder="كل القنوات"
            clearable
            hide-details
            density="compact"
          />
          <v-btn
            :variant="unreadOnly ? 'tonal' : 'text'"
            :color="unreadOnly ? 'primary' : undefined"
            size="small"
            prepend-icon="mdi-email-mark-as-unread"
            @click="unreadOnly = !unreadOnly"
          >
            غير المقروءة
          </v-btn>
        </div>
      </div>

      <v-tabs v-model="tab" density="compact" show-arrows color="primary" class="mt-2 border-b">
        <v-tab v-for="item in tabs" :key="item.key" :value="item.key" class="text-caption">
          {{ item.title }}
          <v-badge
            v-if="stats && item.count(stats)"
            :content="item.count(stats) ?? 0"
            color="primary"
            inline
          />
        </v-tab>
      </v-tabs>

      <ErrorState
        v-if="loadError"
        :message="loadError.message"
        :correlation-id="loadError.correlationId"
        @retry="load()"
      />
      <ConversationList
        v-else
        class="inbox-scroll"
        :items="conversations"
        :selected-id="selectedId"
        :loading="loading && page === 1"
        :has-more="hasMore"
        @select="select"
        @load-more="loadMore"
      />
    </section>

    <!-- Thread column -->
    <section v-if="mdAndUp || selectedId" class="inbox-thread">
      <ConversationThread
        v-if="selectedId"
        :conversation-id="selectedId"
        :assignees="assignees"
        :show-back="!mdAndUp"
        @back="back"
      />

      <div v-else class="d-flex flex-column align-center justify-center h-100 text-medium-emphasis pa-6">
        <v-icon icon="mdi-forum-outline" size="64" class="mb-3" />
        <div class="text-subtitle-1">اختر محادثة لعرضها</div>
        <div class="text-body-2 mt-1">تصل رسائل الزبائن الجديدة هنا مباشرة دون تحديث الصفحة.</div>
      </div>
    </section>

    <StartConversationDialog v-model="startOpen" />
  </v-card>
</template>

<style scoped>
.inbox {
  display: flex;
  /* Fills the viewport under the app bar; the container adds 24px padding on each side. */
  height: calc(100dvh - 64px - 48px);
  min-height: 480px;
  overflow: hidden;
}

.inbox-list {
  display: flex;
  flex-direction: column;
  flex: 0 0 360px;
  min-width: 0;
  min-height: 0;
}

.inbox-scroll {
  flex: 1 1 auto;
  min-height: 0;
}

.inbox-thread {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

@media (max-width: 959px) {
  .inbox {
    height: calc(100dvh - 56px - 32px);
  }

  .inbox-list {
    flex: 1 1 auto;
  }
}
</style>
