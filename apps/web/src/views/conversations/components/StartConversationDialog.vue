<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { CHANNEL_ICONS, CHANNEL_LABELS } from '@/constants/labels';
import { conversationsService, customersService } from '@/services/crm.service';
import type { ChannelType, Customer } from '@/types/crm';

const props = defineProps<{
  modelValue: boolean;
  /** Preselected customer, when opened from a customer profile. */
  customer?: Customer | null;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const router = useRouter();
const { submitting, errorMessage, submit } = useFormSubmit();

const formRef = ref();
const selected = ref<Customer | null>(null);
const channel = ref<ChannelType | null>(null);
const subject = ref('');

const search = ref('');
const results = ref<Customer[]>([]);
const searching = ref(false);

/**
 * Only channels the customer can actually be reached on: WhatsApp needs a number, and
 * Instagram/Messenger only allow replies to someone who has written to the page first.
 */
const channelOptions = computed(() => {
  const customer = selected.value;
  if (!customer) return [];

  const available = new Set<ChannelType>(customer.channels);
  if (customer.phone) available.add('WHATSAPP');

  return [...available].map((value) => ({
    value,
    title: CHANNEL_LABELS[value],
    prependIcon: CHANNEL_ICONS[value],
  }));
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    errorMessage.value = null;
    selected.value = props.customer ?? null;
    subject.value = '';
    search.value = '';
    results.value = props.customer ? [props.customer] : [];
  },
);

watch(channelOptions, (options) => {
  channel.value = options.length === 1 ? options[0].value : null;
});

let searchTimer: number | undefined;

watch(search, (term) => {
  window.clearTimeout(searchTimer);
  if (!term || term === selected.value?.name) return;

  searchTimer = window.setTimeout(async () => {
    searching.value = true;
    try {
      results.value = (await customersService.list({ search: term, limit: 10, status: 'ACTIVE' })).items;
    } catch {
      results.value = [];
    } finally {
      searching.value = false;
    }
  }, 300);
});

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid || !selected.value || !channel.value) return;

  const customerId = selected.value.id;
  const target = channel.value;

  await submit(
    () =>
      conversationsService.create({
        customerId,
        channel: target,
        subject: subject.value.trim() || undefined,
      }),
    {
      onSuccess: (conversation) => {
        emit('update:modelValue', false);
        router.push({ name: 'conversations', params: { id: conversation.id } });
      },
    },
  );
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">محادثة جديدة</v-card-title>

      <v-divider />

      <v-card-text>
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <v-form ref="formRef" @submit.prevent="onSubmit">
          <v-autocomplete
            v-model="selected"
            v-model:search="search"
            :items="results"
            :loading="searching"
            :disabled="Boolean(customer)"
            item-title="name"
            return-object
            no-filter
            label="الزبون"
            placeholder="ابحث بالاسم أو رقم الهاتف"
            no-data-text="اكتب للبحث عن زبون"
            :rules="[rules.required('اختر زبوناً')]"
            class="mb-4"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps" :subtitle="item.raw.phone ?? item.raw.city ?? ''" />
            </template>
          </v-autocomplete>

          <v-select
            v-model="channel"
            :items="channelOptions"
            label="القناة"
            :disabled="!selected"
            :no-data-text="'لا توجد قناة متاحة لهذا الزبون'"
            :hint="
              selected && !channelOptions.length
                ? 'أضف رقم هاتف للزبون لمراسلته على واتساب'
                : undefined
            "
            persistent-hint
            :rules="[rules.required('اختر القناة')]"
            class="mb-4"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps" :prepend-icon="item.raw.prependIcon" />
            </template>
          </v-select>

          <v-text-field
            v-model="subject"
            label="الموضوع (اختياري)"
            placeholder="مثال: متابعة طلب سابق"
            :rules="[rules.maxLength(160)]"
          />
        </v-form>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn color="primary" :loading="submitting" @click="onSubmit">بدء المحادثة</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
