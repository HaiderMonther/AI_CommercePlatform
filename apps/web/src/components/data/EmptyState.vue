<script setup lang="ts">
withDefaults(
  defineProps<{
    icon?: string;
    title: string;
    description?: string;
    actionLabel?: string;
  }>(),
  { icon: 'mdi-inbox-outline', description: undefined, actionLabel: undefined },
);

defineEmits<{ action: [] }>();
</script>

<template>
  <div class="text-center py-10 px-4">
    <v-icon :icon="icon" size="56" class="text-medium-emphasis mb-3" />
    <div class="text-subtitle-1 font-weight-medium">{{ title }}</div>
    <div v-if="description" class="text-body-2 text-medium-emphasis mt-1">{{ description }}</div>

    <v-btn v-if="actionLabel" color="primary" class="mt-4" @click="$emit('action')">
      {{ actionLabel }}
    </v-btn>
  </div>
</template>
