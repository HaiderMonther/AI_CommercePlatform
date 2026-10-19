<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    value: string | number;
    icon: string;
    color?: string;
    hint?: string;
    loading?: boolean;
    /** Percentage change against the previous period; null when there is none. */
    delta?: number | null;
    /** What the change is measured against, e.g. "عن الـ30 يوماً السابقة". */
    deltaLabel?: string;
  }>(),
  { color: 'primary', hint: undefined, loading: false, delta: undefined, deltaLabel: undefined },
);

// Every delta shown here is one where up is good (orders, revenue).
const deltaTone = computed(() =>
  props.delta == null || props.delta === 0
    ? { color: 'medium-emphasis', icon: 'mdi-minus' }
    : props.delta > 0
      ? { color: 'success', icon: 'mdi-arrow-top-right' }
      : { color: 'error', icon: 'mdi-arrow-bottom-right' },
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

    <div v-if="delta !== undefined && !loading" class="d-flex align-center ga-1 mt-2 text-caption">
      <template v-if="delta !== null">
        <v-icon :icon="deltaTone.icon" :color="deltaTone.color" size="14" />
        <span :class="`text-${deltaTone.color}`" class="font-weight-medium numeric" dir="ltr">
          {{ delta > 0 ? '+' : '' }}{{ delta }}%
        </span>
      </template>
      <span v-else class="text-medium-emphasis">لا توجد فترة سابقة للمقارنة</span>
      <span v-if="delta !== null && deltaLabel" class="text-medium-emphasis">{{ deltaLabel }}</span>
    </div>
    <div v-if="hint" class="text-caption text-medium-emphasis mt-2">{{ hint }}</div>
  </v-card>
</template>

<style scoped>
.min-w-0 {
  min-width: 0;
}
</style>
