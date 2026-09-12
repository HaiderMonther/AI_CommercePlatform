<script setup lang="ts">
withDefaults(defineProps<{ message?: string; correlationId?: string }>(), {
  message: 'تعذر تحميل البيانات',
  correlationId: undefined,
});

defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="text-center py-10 px-4">
    <v-icon icon="mdi-cloud-alert-outline" size="56" class="text-error mb-3" />
    <div class="text-subtitle-1 font-weight-medium">{{ message }}</div>

    <!-- The correlation id is what support needs to find the request in the API logs. -->
    <div v-if="correlationId" class="text-caption text-medium-emphasis mt-1">
      معرف الطلب: <span class="numeric">{{ correlationId }}</span>
    </div>

    <v-btn variant="tonal" color="primary" class="mt-4" prepend-icon="mdi-refresh" @click="$emit('retry')">
      إعادة المحاولة
    </v-btn>
  </div>
</template>
