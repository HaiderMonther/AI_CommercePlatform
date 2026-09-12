<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="d-flex flex-wrap align-center justify-space-between ga-3 mb-5">
    <div class="min-w-0">
      <h1 class="page-title">{{ title }}</h1>
      <div v-if="subtitle" class="page-subtitle">{{ subtitle }}</div>
    </div>

    <div class="d-flex align-center ga-2 flex-wrap">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.min-w-0 {
  min-width: 0;
}
</style>
