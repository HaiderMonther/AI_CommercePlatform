<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber } from '@/utils/format';

/**
 * How much of a plan limit is used. The fill carries the severity (normal → warning near
 * the limit → error at it); the track is a faint step of the same colour, so the state
 * reads across the whole bar. Severity is also spelled out in text, never colour alone.
 */
const props = defineProps<{
  label: string;
  used: number;
  /** null = unlimited */
  limit: number | null;
  hint?: string;
}>();

const ratio = computed(() =>
  props.limit === null ? 0 : props.limit === 0 ? 1 : Math.min(props.used / props.limit, 1),
);

const tone = computed(() => {
  if (props.limit === null) return { color: 'chart', note: 'بلا حد' };
  if (ratio.value >= 1) return { color: 'error', note: 'وصلت للحد' };
  if (ratio.value >= 0.8) return { color: 'warning', note: 'قريب من الحد' };
  return { color: 'chart', note: null };
});
</script>

<template>
  <div>
    <div class="d-flex align-center ga-2 mb-1">
      <span class="text-body-2 flex-grow-1">{{ label }}</span>
      <span class="text-body-2 font-weight-medium numeric" dir="ltr">
        {{ formatNumber(used)
        }}<template v-if="limit !== null"> / {{ formatNumber(limit) }}</template>
      </span>
    </div>
    <div
      class="track"
      role="meter"
      :aria-label="label"
      :aria-valuenow="used"
      :aria-valuemin="0"
      :aria-valuemax="limit ?? undefined"
      :style="{ background: `rgba(var(--v-theme-${tone.color}), 0.16)` }"
    >
      <div
        class="fill"
        :style="{
          width: limit === null ? '100%' : `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%`,
          background: `rgba(var(--v-theme-${tone.color}), ${limit === null ? 0.35 : 1})`,
        }"
      />
    </div>
    <div v-if="tone.note || hint" class="d-flex ga-2 mt-1 text-caption">
      <span
        v-if="tone.note"
        :class="tone.color === 'chart' ? 'text-medium-emphasis' : `text-${tone.color}`"
      >
        {{ tone.note }}
      </span>
      <span v-if="hint" class="text-medium-emphasis">{{ hint }}</span>
    </div>
  </div>
</template>

<style scoped>
.track {
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 4px;
}
</style>
