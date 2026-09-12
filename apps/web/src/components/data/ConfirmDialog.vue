<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    color?: string;
    loading?: boolean;
  }>(),
  { confirmLabel: 'تأكيد', color: 'error', loading: false },
);

defineEmits<{ 'update:modelValue': [value: boolean]; confirm: [] }>();
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="440"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">{{ title }}</v-card-title>
      <v-card-text class="text-body-2">{{ message }}</v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="loading" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn :color="color" :loading="loading" @click="$emit('confirm')">
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
