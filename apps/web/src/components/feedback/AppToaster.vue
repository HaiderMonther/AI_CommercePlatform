<script setup lang="ts">
import { useUiStore } from '@/stores/ui.store';

const ui = useUiStore();

const ICONS: Record<string, string> = {
  success: 'mdi-check-circle-outline',
  error: 'mdi-alert-circle-outline',
  warning: 'mdi-alert-outline',
  info: 'mdi-information-outline',
};
</script>

<template>
  <!-- In-app toasts; browser notifications are reserved for events the merchant
       must not miss while the tab is in the background (Phase 7). -->
  <div class="app-toaster">
    <v-alert
      v-for="toast in ui.toasts"
      :key="toast.id"
      :type="toast.kind"
      :icon="ICONS[toast.kind]"
      variant="elevated"
      class="mb-2"
      closable
      @click:close="ui.dismiss(toast.id)"
    >
      {{ toast.message }}
    </v-alert>
  </div>
</template>

<style scoped>
.app-toaster {
  position: fixed;
  bottom: 16px;
  inset-inline-start: 16px;
  z-index: 3000;
  width: min(380px, calc(100vw - 32px));
  pointer-events: auto;
}
</style>
