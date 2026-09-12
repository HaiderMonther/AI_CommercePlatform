<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    value: string | number;
    icon: string;
    color?: string;
    hint?: string;
    loading?: boolean;
  }>(),
  { color: 'primary', hint: undefined, loading: false },
);
</script>

<template>
  <v-card class="pa-4 h-100">
    <div class="d-flex align-center ga-3">
      <v-avatar :color="color" variant="tonal" rounded="lg" size="46">
        <v-icon :icon="icon" size="24" />
      </v-avatar>

      <div class="flex-grow-1 min-w-0">
        <div class="text-caption text-medium-emphasis">{{ title }}</div>

        <v-skeleton-loader v-if="loading" type="text" class="mt-1" width="80" />
        <div v-else class="text-h6 font-weight-bold numeric">{{ value }}</div>
      </div>
    </div>

    <div v-if="hint" class="text-caption text-medium-emphasis mt-2">{{ hint }}</div>
  </v-card>
</template>

<style scoped>
.min-w-0 {
  min-width: 0;
}
</style>
