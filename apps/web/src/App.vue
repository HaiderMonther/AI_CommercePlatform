<script setup lang="ts">
import { watch } from 'vue';
import { useTheme } from 'vuetify';
import AppToaster from '@/components/feedback/AppToaster.vue';
import { useUiStore } from '@/stores/ui.store';

const ui = useUiStore();
const theme = useTheme();

watch(
  () => ui.darkMode,
  (dark) => {
    theme.global.name.value = dark ? 'dark' : 'light';
  },
  { immediate: true },
);
</script>

<template>
  <v-app>
    <router-view />
    <AppToaster />
  </v-app>
</template>
