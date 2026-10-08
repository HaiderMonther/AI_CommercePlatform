<script setup lang="ts">
import { CHANNEL_COLORS, CHANNEL_ICONS, CHANNEL_LABELS } from '@/constants/labels';
import type { ChannelType } from '@/types/crm';

withDefaults(defineProps<{ channels: ChannelType[]; size?: number }>(), { size: 18 });
</script>

<template>
  <div class="d-inline-flex align-center ga-1">
    <v-icon
      v-for="channel in channels"
      :key="channel"
      :icon="CHANNEL_ICONS[channel]"
      :color="CHANNEL_COLORS[channel]"
      :size="size"
      :title="CHANNEL_LABELS[channel]"
    />
    <span v-if="!channels.length" class="text-medium-emphasis">—</span>
  </div>
</template>
