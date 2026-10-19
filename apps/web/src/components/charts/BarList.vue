<script setup lang="ts">
import { computed } from 'vue';

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** Shown after the value, e.g. "12 طلباً". */
  detail?: string;
  icon?: string;
}

/**
 * Ranked horizontal bars: label, bar, value at the tip. One hue for every bar, since the
 * length is the message and the label carries identity. HTML rather than SVG, so the
 * labels wrap and the bars grow from the start edge in either direction of text.
 */
const props = withDefaults(
  defineProps<{
    items: BarItem[];
    format?: (value: number) => string;
    emptyText?: string;
  }>(),
  { format: (value: number) => value.toLocaleString('en-US'), emptyText: 'لا توجد بيانات للفترة' },
);

const max = computed(() => Math.max(0, ...props.items.map((item) => item.value)));
const share = (value: number) =>
  max.value ? Math.max((value / max.value) * 100, value > 0 ? 1.5 : 0) : 0;
</script>

<template>
  <div v-if="!items.length" class="text-body-2 text-medium-emphasis py-6 text-center">
    {{ emptyText }}
  </div>

  <ul v-else class="bar-list">
    <li v-for="item in items" :key="item.key" class="bar-row">
      <div class="d-flex align-center ga-2 mb-1">
        <v-icon v-if="item.icon" :icon="item.icon" size="16" class="text-medium-emphasis" />
        <span class="text-body-2 text-truncate flex-grow-1">{{ item.label }}</span>
        <span class="text-body-2 font-weight-medium numeric">{{ format(item.value) }}</span>
        <span v-if="item.detail" class="text-caption text-medium-emphasis numeric">{{
          item.detail
        }}</span>
      </div>
      <div class="track" role="presentation">
        <div class="bar" :style="{ width: `${share(item.value)}%` }" />
      </div>
    </li>
  </ul>
</template>

<style scoped>
.bar-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.bar-row + .bar-row {
  margin-top: 12px;
}

.track {
  height: 8px;
}

.bar {
  height: 100%;
  background: rgb(var(--v-theme-chart));
  /* Rounded data end, square where the bar starts. */
  border-start-end-radius: 4px;
  border-end-end-radius: 4px;
}
</style>
