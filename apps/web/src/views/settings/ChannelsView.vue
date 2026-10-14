<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ConfirmDialog from '@/components/data/ConfirmDialog.vue';
import EmptyState from '@/components/data/EmptyState.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import ChannelFormDialog from './components/ChannelFormDialog.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import {
  CHANNEL_ACCOUNT_ID_LABELS,
  CHANNEL_COLORS,
  CHANNEL_ICONS,
  CHANNEL_LABELS,
  CHANNEL_STATUS_COLORS,
  CHANNEL_STATUS_LABELS,
} from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { channelsService } from '@/services/channels.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type { ChannelConnection } from '@/types/channels';
import { formatRelative } from '@/utils/format';

const auth = useAuthStore();
const ui = useUiStore();

const {
  data: channels,
  loading,
  error,
  execute,
} = useAsyncData<ChannelConnection[]>(() => channelsService.list(), []);

onMounted(execute);

const canManage = computed(() => auth.can(PERMISSIONS.CHANNELS_MANAGE));

const formOpen = ref(false);
const editing = ref<ChannelConnection | null>(null);
const deleteTarget = ref<ChannelConnection | null>(null);
const deleting = ref(false);
const busy = ref<string | null>(null);

/** The callback URL to paste into the Meta app, built from the API base the app uses. */
function webhookUrl(channel: ChannelConnection): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
  const absolute = new URL(base.endsWith('/') ? base : `${base}/`, window.location.origin);
  return new URL(channel.webhookPath, absolute).toString();
}

function replace(updated: ChannelConnection): void {
  const list = channels.value;
  channels.value = list.some((item) => item.id === updated.id)
    ? list.map((item) => (item.id === updated.id ? updated : item))
    : [...list, updated];
}

function openCreate(): void {
  editing.value = null;
  formOpen.value = true;
}

function openEdit(channel: ChannelConnection): void {
  editing.value = channel;
  formOpen.value = true;
}

function onSaved(channel: ChannelConnection): void {
  replace(channel);
  if (channel.status === 'CONNECTED') {
    ui.success('القناة متصلة وتعمل');
  } else {
    ui.error(`حُفظت القناة لكن فحص الاتصال فشل: ${channel.lastError ?? 'خطأ غير معروف'}`);
  }
}

async function run(
  channel: ChannelConnection,
  action: () => Promise<ChannelConnection>,
  success: string,
) {
  busy.value = channel.id;
  try {
    const updated = await action();
    replace(updated);
    if (updated.status === 'ERROR') ui.error(updated.lastError ?? 'فشل فحص الاتصال');
    else ui.success(success);
  } catch (caught) {
    ui.error(caught instanceof ApiError ? caught.message : 'تعذر تنفيذ العملية');
  } finally {
    busy.value = null;
  }
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    ui.success('تم النسخ');
  } catch {
    ui.error('تعذر النسخ، انسخه يدوياً');
  }
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    await channelsService.remove(deleteTarget.value.id);
    channels.value = channels.value.filter((item) => item.id !== deleteTarget.value?.id);
    ui.success('تم حذف القناة');
    deleteTarget.value = null;
  } catch (caught) {
    ui.error(caught instanceof ApiError ? caught.message : 'تعذر حذف القناة');
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="القنوات"
      subtitle="حسابات واتساب وصفحات فيسبوك وإنستغرام التي تصل منها رسائل الزبائن وتُرسل منها الردود"
    >
      <template #actions>
        <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openCreate">
          ربط قناة
        </v-btn>
      </template>
    </PageHeader>

    <ErrorState
      v-if="error"
      :message="error.message"
      :correlation-id="error.correlationId"
      @retry="execute"
    />

    <v-skeleton-loader v-else-if="loading && !channels.length" type="card, card" />

    <v-card v-else-if="!channels.length">
      <EmptyState
        icon="mdi-transit-connection-variant"
        title="لا توجد قنوات مربوطة"
        description="اربط رقم واتساب أو صفحة فيسبوك أو حساب إنستغرام لتصل رسائل الزبائن إلى صندوق المحادثات."
        :action-label="canManage ? 'ربط قناة' : undefined"
        @action="openCreate"
      />
    </v-card>

    <v-row v-else>
      <v-col v-for="channel in channels" :key="channel.id" cols="12" lg="6">
        <v-card :class="{ 'opacity-60': !channel.isActive }">
          <v-card-item>
            <template #prepend>
              <v-avatar :color="CHANNEL_COLORS[channel.type]" variant="tonal" size="44">
                <v-icon :icon="CHANNEL_ICONS[channel.type]" />
              </v-avatar>
            </template>
            <v-card-title class="text-subtitle-1 font-weight-bold">{{ channel.name }}</v-card-title>
            <v-card-subtitle>
              {{ CHANNEL_LABELS[channel.type] }} ·
              <bdi dir="ltr"
                >{{ CHANNEL_ACCOUNT_ID_LABELS[channel.type] }} {{ channel.externalId }}</bdi
              >
            </v-card-subtitle>
            <template #append>
              <v-chip
                :color="channel.isActive ? CHANNEL_STATUS_COLORS[channel.status] : 'default'"
                size="small"
                variant="tonal"
              >
                {{ channel.isActive ? CHANNEL_STATUS_LABELS[channel.status] : 'موقوفة' }}
              </v-chip>
            </template>
          </v-card-item>

          <v-card-text class="pt-0">
            <v-alert
              v-if="channel.status === 'ERROR' && channel.lastError"
              type="error"
              variant="tonal"
              density="compact"
              class="mb-3 text-body-2"
            >
              {{ channel.lastError }}
            </v-alert>

            <div class="text-caption text-medium-emphasis mb-1">
              عنوان الـ Webhook في تطبيق Meta
            </div>
            <div class="d-flex align-center ga-2 mb-3">
              <code class="webhook-url flex-grow-1" dir="ltr">{{ webhookUrl(channel) }}</code>
              <v-btn
                icon="mdi-content-copy"
                size="small"
                variant="text"
                aria-label="نسخ العنوان"
                @click="copy(webhookUrl(channel))"
              />
            </div>

            <div class="d-flex flex-wrap ga-4 text-body-2 text-medium-emphasis">
              <span
                ><v-icon icon="mdi-key-outline" size="16" /> رمز ينتهي بـ
                <bdi dir="ltr">{{ channel.tokenHint ?? '—' }}</bdi></span
              >
              <span
                ><v-icon icon="mdi-forum-outline" size="16" />
                {{ channel.conversationsCount }} محادثة</span
              >
              <span
                ><v-icon icon="mdi-sync" size="16" /> آخر نشاط
                {{ formatRelative(channel.lastSyncAt) }}</span
              >
            </div>
          </v-card-text>

          <v-card-actions v-if="canManage" class="px-4 pb-4">
            <v-btn
              variant="tonal"
              prepend-icon="mdi-connection"
              :loading="busy === channel.id"
              @click="run(channel, () => channelsService.verify(channel.id), 'القناة متصلة وتعمل')"
            >
              فحص الاتصال
            </v-btn>
            <v-btn variant="text" prepend-icon="mdi-pencil-outline" @click="openEdit(channel)"
              >
تعديل
</v-btn
            >
            <v-spacer />
            <v-btn
              variant="text"
              :disabled="busy === channel.id"
              @click="
                run(
                  channel,
                  () =>
                    channelsService.update(channel.id, {
                      isActive: !channel.isActive,
                    }),
                  channel.isActive ? 'أُوقفت القناة' : 'فُعّلت القناة',
                )
              "
            >
              {{ channel.isActive ? 'إيقاف' : 'تفعيل' }}
            </v-btn>
            <v-btn
              icon="mdi-delete-outline"
              variant="text"
              color="error"
              aria-label="حذف"
              @click="deleteTarget = channel"
            />
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-alert type="info" variant="tonal" class="mt-6 text-body-2" icon="mdi-information-outline">
      في تطبيق Meta، ضع عنوان الـ Webhook أعلاه ورمز التحقق (META_VERIFY_TOKEN) المضبوط على الخادم،
      ثم اشترك في حقل <bdi dir="ltr">messages</bdi>. تُرفض أي رسالة غير موقّعة بسر التطبيق.
    </v-alert>

    <ChannelFormDialog v-model="formOpen" :channel="editing" @saved="onSaved" />

    <ConfirmDialog
      :model-value="Boolean(deleteTarget)"
      title="حذف القناة"
      :message="`ستتوقف رسائل «${deleteTarget?.name ?? ''}» عن الوصول. تبقى المحادثات السابقة، وتُرسل ردودها عبر قناة أخرى من النوع نفسه إن وُجدت.`"
      confirm-label="حذف"
      :loading="deleting"
      @update:model-value="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.webhook-url {
  font-size: 0.8rem;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  overflow-wrap: anywhere;
}
</style>
