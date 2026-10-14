<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { CHANNEL_ACCOUNT_ID_LABELS, CHANNEL_ICONS, CHANNEL_LABELS } from '@/constants/labels';
import { channelsService } from '@/services/channels.service';
import type { ChannelConnection } from '@/types/channels';
import type { ChannelType } from '@/types/crm';

const props = defineProps<{
  modelValue: boolean;
  channel: ChannelConnection | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [channel: ChannelConnection];
}>();

const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const formRef = ref();
const form = ref({
  type: 'WHATSAPP' as ChannelType,
  name: '',
  externalId: '',
  accessToken: '',
});
const showToken = ref(false);

const isEdit = computed(() => Boolean(props.channel));

const typeOptions = (Object.keys(CHANNEL_LABELS) as ChannelType[]).map((value) => ({
  value,
  title: CHANNEL_LABELS[value],
  props: { prependIcon: CHANNEL_ICONS[value] },
}));

const idHint: Record<ChannelType, string> = {
  WHATSAPP: 'من WhatsApp Manager ← API Setup، وليس رقم الهاتف نفسه',
  FACEBOOK: 'من إعدادات الصفحة ← معلومات الصفحة',
  INSTAGRAM: 'معرف حساب إنستغرام التجاري المرتبط بالصفحة',
};

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    errorMessage.value = null;
    fieldErrors.value = [];
    showToken.value = false;
    form.value = props.channel
      ? {
          type: props.channel.type,
          name: props.channel.name,
          externalId: props.channel.externalId,
          accessToken: '',
        }
      : { type: 'WHATSAPP', name: '', externalId: '', accessToken: '' };
  },
);

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  const value = form.value;
  const token = value.accessToken.trim();

  await submit(
    () =>
      props.channel
        ? channelsService.update(props.channel.id, {
            name: value.name.trim(),
            ...(token ? { accessToken: token } : {}),
          })
        : channelsService.create({
            type: value.type,
            name: value.name.trim(),
            externalId: value.externalId.trim(),
            accessToken: token,
          }),
    {
      onSuccess: (saved) => {
        emit('saved', saved);
        emit('update:modelValue', false);
      },
    },
  );
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
        {{ isEdit ? 'تعديل القناة' : 'ربط قناة' }}
      </v-card-title>

      <v-divider />

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
          <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
            <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
          </ul>
        </v-alert>

        <v-form ref="formRef" @submit.prevent="onSubmit">
          <v-select
            v-model="form.type"
            :items="typeOptions"
            label="القناة"
            :disabled="isEdit"
            class="mb-2"
          />

          <v-text-field
            v-model="form.name"
            label="اسم داخلي"
            placeholder="واتساب المبيعات"
            :rules="[rules.required(), rules.minLength(2), rules.maxLength(80)]"
            class="mb-2"
          />

          <v-text-field
            v-model="form.externalId"
            :label="CHANNEL_ACCOUNT_ID_LABELS[form.type]"
            :hint="idHint[form.type]"
            persistent-hint
            dir="ltr"
            :disabled="isEdit"
            :rules="[rules.required(), (v: string) => /^\d{5,25}$/.test(v.trim()) || 'أرقام فقط']"
            class="mb-4"
          />

          <v-text-field
            v-model="form.accessToken"
            label="رمز الوصول (Access token)"
            :type="showToken ? 'text' : 'password'"
            :append-inner-icon="showToken ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
            dir="ltr"
            autocomplete="off"
            :hint="
              isEdit
                ? `المثبّت حالياً ينتهي بـ ${channel?.tokenHint ?? '—'}. اتركه فارغاً للإبقاء عليه.`
                : 'رمز دائم من System User في Business Manager. يُخزَّن مشفّراً ولا يُعرض مجدداً.'
            "
            persistent-hint
            :rules="isEdit ? [] : [rules.required(), rules.minLength(20, 'رمز الوصول قصير جداً')]"
            @click:append-inner="showToken = !showToken"
          />
        </v-form>
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn color="primary" variant="flat" :loading="submitting" @click="onSubmit">
          {{ isEdit ? 'حفظ' : 'ربط وفحص' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
