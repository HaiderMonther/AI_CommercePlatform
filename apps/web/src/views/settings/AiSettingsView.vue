<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import {
  AI_LANGUAGE_LABELS,
  AI_TONE_LABELS,
  AI_TOOL_LABELS,
  PAYMENT_METHOD_LABELS,
} from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { aiService } from '@/services/ai.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type { AiSettings, AiSettingsPayload, AiTestResult, AiTestTurn } from '@/types/ai';
import type { PaymentMethod } from '@/types/orders';
import { formatNumber } from '@/utils/format';

const auth = useAuthStore();
const ui = useUiStore();
const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const settings = ref<AiSettings | null>(null);
const loading = ref(false);
const loadError = ref<ApiError | null>(null);
const formRef = ref();

const form = ref({
  enabled: true,
  autoReply: true,
  businessName: '',
  businessDescription: '',
  tone: 'friendly',
  language: 'ar-IQ',
  model: 'claude-opus-5-5',
  workingHours: '',
  deliveryPolicy: '',
  returnPolicy: '',
  paymentMethods: [] as PaymentMethod[],
  customInstructions: '',
  handoverKeywords: [] as string[],
});

const canUpdate = computed(() => auth.can(PERMISSIONS.AI_SETTINGS_UPDATE));

const toneOptions = computed(() =>
  (settings.value?.options.tones ?? []).map((value) => ({
    value,
    title: AI_TONE_LABELS[value] ?? value,
  })),
);
const languageOptions = computed(() =>
  (settings.value?.options.languages ?? []).map((value) => ({
    value,
    title: AI_LANGUAGE_LABELS[value] ?? value,
  })),
);
const modelOptions = computed(() =>
  (settings.value?.options.models ?? []).map((model) => ({
    value: model.id,
    title: model.label,
    subtitle: model.description,
  })),
);
const paymentOptions = Object.entries(PAYMENT_METHOD_LABELS).map(([value, title]) => ({
  value,
  title,
}));

function fill(value: AiSettings): void {
  settings.value = value;
  form.value = {
    enabled: value.enabled,
    autoReply: value.autoReply,
    businessName: value.businessName ?? '',
    businessDescription: value.businessDescription ?? '',
    tone: value.tone,
    language: value.language,
    model: value.model,
    workingHours: value.workingHours ?? '',
    deliveryPolicy: value.deliveryPolicy ?? '',
    returnPolicy: value.returnPolicy ?? '',
    paymentMethods: [...value.paymentMethods],
    customInstructions: value.customInstructions ?? '',
    handoverKeywords: [...value.handoverKeywords],
  };
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    fill(await aiService.getConfig());
  } catch (error) {
    loadError.value = error instanceof ApiError ? error : null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function save(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  const payload: AiSettingsPayload = {
    ...form.value,
    businessName: form.value.businessName.trim() || undefined,
  };

  await submit(() => aiService.updateConfig(payload), {
    successMessage: 'تم حفظ إعدادات المساعد',
    onSuccess: fill,
  });
}

// --- Test chat -------------------------------------------------------------

interface ChatEntry extends AiTestTurn {
  result?: AiTestResult;
}

const chat = ref<ChatEntry[]>([]);
const draft = ref('');
const testing = ref(false);
const chatBox = ref<HTMLElement | null>(null);

async function sendTest(): Promise<void> {
  const message = draft.value.trim();
  if (!message || testing.value) return;

  const history: AiTestTurn[] = chat.value.map(({ role, content }) => ({ role, content }));
  chat.value.push({ role: 'customer', content: message });
  draft.value = '';
  testing.value = true;
  await scrollChat();

  try {
    const result = await aiService.test(message, history);
    chat.value.push({
      role: 'assistant',
      content: result.reply ?? (result.handoverReason ? '— تحويل لموظف —' : '— بلا رد —'),
      result,
    });
  } catch (error) {
    // Drop the unanswered message so the history sent next time stays consistent.
    chat.value.pop();
    draft.value = message;
    ui.error(error instanceof ApiError ? error.message : 'تعذرت التجربة');
  } finally {
    testing.value = false;
    await scrollChat();
  }
}

async function scrollChat(): Promise<void> {
  await nextTick();
  chatBox.value?.scrollTo({ top: chatBox.value.scrollHeight, behavior: 'smooth' });
}

function onTestKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendTest();
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="المساعد الذكي"
      subtitle="يرد على الزبائن، يبحث في المنتجات والأسعار، ويأخذ الطلبات من المحادثة"
    >
      <template #actions>
        <v-btn
          v-if="canUpdate && settings"
          color="primary"
          prepend-icon="mdi-content-save-outline"
          :loading="submitting"
          @click="save"
        >
          حفظ
        </v-btn>
      </template>
    </PageHeader>

    <ErrorState
      v-if="loadError"
      :message="loadError.message"
      :correlation-id="loadError.correlationId"
      @retry="load"
    />

    <v-skeleton-loader v-else-if="loading && !settings" type="card, card" />

    <template v-else-if="settings">
      <v-alert
        v-if="!settings.providerConfigured"
        type="warning"
        variant="tonal"
        class="mb-4"
        title="المساعد غير مفعّل على الخادم"
      >
        لم يُضبط مفتاح Claude API (المتغير <code>AI_API_KEY</code>). حتى يُضبط، تصل كل المحادثات
        للموظفين ولا يرد المساعد على أحد.
      </v-alert>

      <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
        {{ errorMessage }}
        <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
          <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
        </ul>
      </v-alert>

      <v-row>
        <v-col cols="12" lg="7">
          <v-form ref="formRef" :disabled="!canUpdate" @submit.prevent="save">
            <v-card class="mb-4">
              <v-card-title class="text-subtitle-1 font-weight-bold">التشغيل</v-card-title>
              <v-card-text>
                <v-switch
                  v-model="form.enabled"
                  color="primary"
                  label="تفعيل المساعد الذكي"
                  hide-details
                  inset
                />
                <v-switch
                  v-model="form.autoReply"
                  color="primary"
                  label="الرد التلقائي على المحادثات الجديدة"
                  hint="عند إيقافه تصل المحادثات للموظفين دون رد آلي"
                  persistent-hint
                  :disabled="!form.enabled || !canUpdate"
                  inset
                  class="mb-4"
                />

                <v-select v-model="form.model" :items="modelOptions" label="النموذج" item-props />
              </v-card-text>
            </v-card>

            <v-card class="mb-4">
              <v-card-title class="text-subtitle-1 font-weight-bold"
                >
هوية المتجر وأسلوبه
</v-card-title
              >
              <v-card-text>
                <v-text-field
                  v-model="form.businessName"
                  label="اسم المتجر كما يقدّمه المساعد"
                  :rules="[rules.maxLength(120)]"
                  class="mb-2"
                />
                <v-textarea
                  v-model="form.businessDescription"
                  label="وصف النشاط"
                  rows="2"
                  auto-grow
                  :rules="[rules.maxLength(1000)]"
                  class="mb-2"
                />
                <v-row dense>
                  <v-col cols="12" sm="6">
                    <v-select v-model="form.tone" :items="toneOptions" label="أسلوب الرد" />
                  </v-col>
                  <v-col cols="12" sm="6">
                    <v-select v-model="form.language" :items="languageOptions" label="لغة الرد" />
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>

            <v-card class="mb-4">
              <v-card-title class="text-subtitle-1 font-weight-bold"
                >
ما يعرفه المساعد عن المتجر
</v-card-title
              >
              <v-card-subtitle class="text-wrap">
                المساعد لا يَعِد الزبون إلا بما هو مكتوب هنا. الأسعار والمخزون يقرؤها من الكتالوج
                مباشرة.
              </v-card-subtitle>
              <v-card-text>
                <v-text-field
                  v-model="form.workingHours"
                  label="ساعات العمل"
                  :rules="[rules.maxLength(300)]"
                  class="mb-2"
                />
                <v-textarea
                  v-model="form.deliveryPolicy"
                  label="سياسة التوصيل والأسعار والمدة"
                  rows="2"
                  auto-grow
                  :rules="[rules.maxLength(1500)]"
                  class="mb-2"
                />
                <v-textarea
                  v-model="form.returnPolicy"
                  label="سياسة الإرجاع والاستبدال"
                  rows="2"
                  auto-grow
                  :rules="[rules.maxLength(1500)]"
                  class="mb-2"
                />
                <v-select
                  v-model="form.paymentMethods"
                  :items="paymentOptions"
                  label="طرق الدفع المقبولة"
                  multiple
                  chips
                  closable-chips
                />
              </v-card-text>
            </v-card>

            <v-card>
              <v-card-title class="text-subtitle-1 font-weight-bold"
                >
التحويل لموظف وتعليمات خاصة
</v-card-title
              >
              <v-card-text>
                <v-combobox
                  v-model="form.handoverKeywords"
                  label="كلمات التحويل الفوري لموظف"
                  hint="إذا وردت في رسالة الزبون تتحول المحادثة لموظف مباشرة. اكتب الكلمة ثم Enter"
                  persistent-hint
                  multiple
                  chips
                  closable-chips
                  class="mb-4"
                />
                <v-textarea
                  v-model="form.customInstructions"
                  label="تعليمات إضافية للمساعد"
                  placeholder="مثال: اقترح الحزام المناسب عند شراء بنطلون"
                  rows="3"
                  auto-grow
                  :rules="[rules.maxLength(3000)]"
                />
              </v-card-text>
            </v-card>
          </v-form>
        </v-col>

        <v-col cols="12" lg="5">
          <v-card class="test-card">
            <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
              جرّب المساعد
              <v-spacer />
              <v-btn
                v-if="chat.length"
                size="small"
                variant="text"
                prepend-icon="mdi-refresh"
                @click="chat = []"
              >
                محادثة جديدة
              </v-btn>
            </v-card-title>
            <v-card-subtitle class="text-wrap">
              بالإعدادات المحفوظة. يبحث في منتجاتك فعلياً لكنه لا يُنشئ طلبات ولا يحوّل محادثات.
            </v-card-subtitle>

            <div ref="chatBox" class="chat pa-4">
              <div v-if="!chat.length" class="text-body-2 text-medium-emphasis text-center py-8">
                اكتب رسالة كأنك زبون، مثلاً: «عندكم قميص أسود مقاس L؟»
              </div>

              <div
                v-for="(entry, index) in chat"
                :key="index"
                class="d-flex mb-3"
                :class="entry.role === 'customer' ? 'justify-start' : 'justify-end'"
              >
                <v-sheet
                  rounded="lg"
                  class="px-3 py-2 bubble"
                  :color="entry.role === 'customer' ? 'surface-variant' : undefined"
                  :class="entry.role === 'assistant' ? 'border' : ''"
                >
                  <div class="text-body-2 bubble-text">{{ entry.content }}</div>

                  <template v-if="entry.result">
                    <v-alert
                      v-if="entry.result.handoverReason"
                      density="compact"
                      variant="tonal"
                      type="info"
                      class="mt-2 text-caption"
                    >
                      سيُحوَّل لموظف: {{ entry.result.handoverReason }}
                    </v-alert>
                    <div class="d-flex flex-wrap ga-1 mt-2">
                      <v-chip
                        v-for="(tool, toolIndex) in entry.result.toolCalls"
                        :key="toolIndex"
                        size="x-small"
                        variant="tonal"
                        :color="tool.isError ? 'error' : 'primary'"
                        prepend-icon="mdi-tools"
                      >
                        {{ AI_TOOL_LABELS[tool.name] ?? tool.name }}
                      </v-chip>
                    </div>
                    <div class="text-caption text-medium-emphasis mt-1 numeric">
                      {{ (entry.result.latencyMs / 1000).toFixed(1) }} ث ·
                      {{
                        formatNumber(
                          entry.result.usage.input +
                            entry.result.usage.cacheRead +
                            entry.result.usage.cacheWrite +
                            entry.result.usage.output,
                        )
                      }}
                      رمز
                    </div>
                  </template>
                </v-sheet>
              </div>

              <div v-if="testing" class="d-flex justify-end">
                <v-progress-circular indeterminate size="20" width="2" color="primary" />
              </div>
            </div>

            <v-divider />

            <div class="d-flex align-end ga-2 pa-3">
              <v-textarea
                v-model="draft"
                placeholder="رسالة الزبون…"
                rows="1"
                auto-grow
                max-rows="4"
                hide-details
                :disabled="!settings.providerConfigured || !canUpdate"
                @keydown="onTestKeydown"
              />
              <v-btn
                icon="mdi-send"
                color="primary"
                aria-label="إرسال"
                :loading="testing"
                :disabled="!draft.trim() || !settings.providerConfigured || !canUpdate"
                @click="sendTest"
              />
            </div>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </div>
</template>

<style scoped>
.test-card {
  position: sticky;
  top: 80px;
}

.chat {
  height: 420px;
  overflow-y: auto;
}

.bubble {
  max-width: 85%;
}

.bubble-text {
  white-space: pre-line;
}
</style>
