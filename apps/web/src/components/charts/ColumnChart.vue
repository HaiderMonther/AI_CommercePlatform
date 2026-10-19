<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useLocale } from 'vuetify';
import { compactNumber, labelEvery, niceTicks } from '@/utils/charts';

export interface ColumnPoint {
  key: string;
  /** Axis label, e.g. a short date. */
  label: string;
  value: number;
  /** Extra line in the tooltip, e.g. "3 طلبات". */
  detail?: string;
}

const props = withDefaults(
  defineProps<{
    points: ColumnPoint[];
    /** What the chart shows, for screen readers and the hidden table caption. */
    title: string;
    format?: (value: number) => string;
    height?: number;
  }>(),
  { format: (value: number) => value.toLocaleString('en-US'), height: 220 },
);

const { isRtl } = useLocale();

// Measured width keeps text at real pixel size instead of scaling with the viewBox.
const root = ref<HTMLElement | null>(null);
const width = ref(600);
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!root.value) return;
  width.value = root.value.clientWidth || 600;
  observer = new ResizeObserver(([entry]) => {
    width.value = Math.max(entry.contentRect.width, 240);
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

const AXIS_WIDTH = 44;
const TOP = 22; // room for the cap label on the tallest column
const BOTTOM = 26;

const plot = computed(() => {
  const left = isRtl.value ? 4 : AXIS_WIDTH;
  const right = width.value - (isRtl.value ? AXIS_WIDTH : 4);
  return { left, right, top: TOP, bottom: props.height - BOTTOM };
});

const ticks = computed(() => niceTicks(Math.max(0, ...props.points.map((p) => p.value))));
const top = computed(() => ticks.value[ticks.value.length - 1] || 1);

const band = computed(
  () => (plot.value.right - plot.value.left) / Math.max(props.points.length, 1),
);
const barWidth = computed(() => Math.max(2, Math.min(24, band.value * 0.6)));
const every = computed(() => labelEvery(props.points.length));
const peak = computed(() =>
  props.points.reduce(
    (best, point, index) => (point.value > (props.points[best]?.value ?? -1) ? index : best),
    -1,
  ),
);

const y = (value: number) =>
  plot.value.bottom - (value / top.value) * (plot.value.bottom - plot.value.top);

const columns = computed(() =>
  props.points.map((point, index) => {
    // Time reads in the direction of the script: right to left in Arabic.
    const slot = isRtl.value ? props.points.length - 1 - index : index;
    const start = plot.value.left + slot * band.value;
    const center = start + band.value / 2;
    const yTop = y(point.value);
    const w = barWidth.value;
    const h = plot.value.bottom - yTop;
    const r = Math.min(4, h, w / 2);
    const x0 = center - w / 2;

    // Rounded data end, square at the baseline.
    const path =
      h <= 0
        ? ''
        : `M${x0},${plot.value.bottom} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + w - r} Q${x0 + w},${yTop} ${x0 + w},${yTop + r} V${plot.value.bottom} Z`;

    // The most recent label always shows, then every n-th back from it.
    const fromEnd = props.points.length - 1 - index;
    return { point, index, start, center, yTop, path, showLabel: fromEnd % every.value === 0 };
  }),
);

const active = ref<number | null>(null);
const activeColumn = computed(() => (active.value === null ? null : columns.value[active.value]));

const tooltipStyle = computed(() => {
  const column = activeColumn.value;
  if (!column) return {};
  // Anchored so the box opens toward the chart's middle and never spills off either edge.
  const shiftX =
    column.center > width.value * 0.7 ? '-100%' : column.center < width.value * 0.3 ? '0%' : '-50%';
  return {
    top: `${Math.max(column.yTop - 8, 0)}px`,
    left: `${column.center}px`,
    transform: `translate(${shiftX}, -100%)`,
  };
});

const summary = computed(() => {
  const total = props.points.reduce((sum, point) => sum + point.value, 0);
  return `${props.title}: ${props.points.length} يوماً، المجموع ${props.format(total)}`;
});
</script>

<template>
  <div ref="root" class="column-chart" @pointerleave="active = null">
    <svg :width="width" :height="height" role="img" :aria-label="summary">
      <!-- Recessive hairline grid and axis values -->
      <g class="grid">
        <template v-for="tick in ticks" :key="tick">
          <line
            :x1="plot.left"
            :x2="plot.right"
            :y1="y(tick)"
            :y2="y(tick)"
            stroke="rgb(var(--v-theme-chart-grid))"
            stroke-width="1"
            shape-rendering="crispEdges"
          />
          <text
            :x="isRtl ? plot.right + 6 : plot.left - 6"
            :y="y(tick)"
            :text-anchor="isRtl ? 'start' : 'end'"
            dominant-baseline="middle"
            class="axis-text"
          >
            {{ compactNumber(tick) }}
          </text>
        </template>
      </g>

      <g>
        <path
          v-for="column in columns"
          :key="column.point.key"
          :d="column.path"
          fill="rgb(var(--v-theme-chart))"
          :opacity="active === null || active === column.index ? 1 : 0.45"
        />
      </g>

      <!-- One direct label: the peak, on its cap -->
      <text
        v-if="peak >= 0 && points[peak].value > 0 && active === null"
        :x="columns[peak].center"
        :y="columns[peak].yTop - 6"
        text-anchor="middle"
        class="cap-text"
      >
        {{ compactNumber(points[peak].value) }}
      </text>

      <g>
        <template v-for="column in columns" :key="`label-${column.point.key}`">
          <text
            v-if="column.showLabel"
            :x="column.center"
            :y="plot.bottom + 17"
            text-anchor="middle"
            class="axis-text"
          >
            {{ column.point.label }}
          </text>
        </template>
      </g>

      <!-- Hit targets: the whole band, larger than the column -->
      <rect
        v-for="column in columns"
        :key="`hit-${column.point.key}`"
        :x="column.start"
        :y="plot.top"
        :width="band"
        :height="plot.bottom - plot.top"
        fill="transparent"
        tabindex="0"
        :aria-label="`${column.point.label}: ${format(column.point.value)}`"
        class="hit"
        @pointerenter="active = column.index"
        @focus="active = column.index"
        @blur="active = null"
      />
    </svg>

    <div v-if="activeColumn" class="chart-tooltip" :style="tooltipStyle" role="status">
      <div class="text-body-2 font-weight-bold numeric">{{ format(activeColumn.point.value) }}</div>
      <div class="text-caption text-medium-emphasis">{{ activeColumn.point.label }}</div>
      <div v-if="activeColumn.point.detail" class="text-caption">
        {{ activeColumn.point.detail }}
      </div>
    </div>

    <!-- The same numbers as a table, for screen readers -->
    <table class="sr-only">
      <caption>
        {{
          title
        }}
      </caption>
      <tbody>
        <tr v-for="point in points" :key="`row-${point.key}`">
          <th scope="row">{{ point.label }}</th>
          <td>{{ format(point.value) }}</td>
          <td v-if="point.detail">{{ point.detail }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.column-chart {
  position: relative;
  width: 100%;
}

svg {
  display: block;
  overflow: visible;
}

.axis-text {
  font-size: 11px;
  fill: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
}

.cap-text {
  font-size: 11px;
  font-weight: 600;
  fill: rgba(var(--v-theme-on-surface), 0.87);
}

.hit {
  cursor: default;
  outline: none;
}

.hit:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
}

.chart-tooltip {
  position: absolute;
  pointer-events: none;
  z-index: 2;
  min-width: 96px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
