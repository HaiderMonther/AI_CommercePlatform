<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDisplay } from 'vuetify';
import { useRouter } from 'vue-router';
import { routes } from '@/router/routes';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { initialsOf } from '@/utils/format';

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const { mdAndDown } = useDisplay();

const loggingOut = ref(false);

// On a phone the drawer is a temporary overlay, so it must start closed or it covers
// the page on every load; on desktop it is permanent and always visible.
watch(
  mdAndDown,
  (isCompact) => {
    ui.drawerOpen = !isCompact;
  },
  { immediate: true },
);

interface NavItem {
  name: string;
  title: string;
  icon: string;
  permissions?: string[];
}

/**
 * The sidebar is derived from the route table so a new screen appears in navigation by
 * declaring its meta, and never shows up for a user who lacks its permission.
 */
const navSections = computed(() => {
  const dashboardRoutes = routes.find((route) => route.path === '/')?.children ?? [];

  const items: NavItem[] = dashboardRoutes
    .filter((route) => route.meta?.icon)
    .map((route) => ({
      name: String(route.name),
      title: String(route.meta?.title ?? ''),
      icon: String(route.meta?.icon ?? ''),
      permissions: route.meta?.permissions as string[] | undefined,
    }))
    .filter((item) => !item.permissions?.length || auth.can(item.permissions));

  const settingsNames = new Set(['users', 'roles', 'company-settings', 'profile', 'audit-logs']);

  return [
    { label: null, items: items.filter((item) => !settingsNames.has(item.name)) },
    { label: 'الإدارة والإعدادات', items: items.filter((item) => settingsNames.has(item.name)) },
  ].filter((section) => section.items.length > 0);
});

// Phases 2-7 add these screens; showing them disabled sets expectations without dead links.
const upcoming = [
  { title: 'المحادثات', icon: 'mdi-forum-outline' },
  { title: 'الطلبات', icon: 'mdi-cart-outline' },
  { title: 'المنتجات', icon: 'mdi-package-variant-closed' },
  { title: 'الزبائن', icon: 'mdi-account-heart-outline' },
  { title: 'التقارير', icon: 'mdi-chart-box-outline' },
];

async function handleLogout(): Promise<void> {
  loggingOut.value = true;
  await auth.logout();
  loggingOut.value = false;
  ui.success('تم تسجيل الخروج');
  router.push({ name: 'login' });
}
</script>

<template>
  <v-navigation-drawer
    v-model="ui.drawerOpen"
    :rail="ui.railMode && !mdAndDown"
    :permanent="!mdAndDown"
    :temporary="mdAndDown"
    width="264"
  >
    <div class="d-flex align-center ga-3 pa-4">
      <v-avatar color="primary" rounded="lg" size="38">
        <v-icon icon="mdi-storefront-outline" color="white" />
      </v-avatar>
      <div v-if="!ui.railMode || mdAndDown" class="min-w-0">
        <div class="text-subtitle-2 font-weight-bold text-truncate">
          {{ auth.company?.name ?? 'شركتي' }}
        </div>
        <div class="text-caption text-medium-emphasis text-truncate">
          {{ auth.user?.roleName ?? '' }}
        </div>
      </div>
    </div>

    <v-divider />

    <v-list nav density="comfortable">
      <template v-for="(section, index) in navSections" :key="index">
        <v-list-subheader v-if="section.label && (!ui.railMode || mdAndDown)">
          {{ section.label }}
        </v-list-subheader>
        <v-divider v-else-if="section.label" class="my-2" />

        <v-list-item
          v-for="item in section.items"
          :key="item.name"
          :to="{ name: item.name }"
          :prepend-icon="item.icon"
          :title="item.title"
          rounded="lg"
        />
      </template>

      <v-divider class="my-2" />
      <v-list-subheader v-if="!ui.railMode || mdAndDown">قريباً</v-list-subheader>

      <v-list-item
        v-for="item in upcoming"
        :key="item.title"
        :prepend-icon="item.icon"
        :title="item.title"
        rounded="lg"
        disabled
      />
    </v-list>
  </v-navigation-drawer>

  <v-app-bar flat border density="comfortable">
    <v-app-bar-nav-icon @click="mdAndDown ? ui.toggleDrawer() : ui.toggleRail()" />

    <v-toolbar-title class="text-subtitle-1 font-weight-bold">
      {{ $route.meta.title }}
    </v-toolbar-title>

    <v-spacer />

    <v-chip
      v-if="auth.company?.status === 'TRIAL'"
      color="warning"
      size="small"
      variant="tonal"
      class="me-2 d-none d-sm-flex"
    >
      فترة تجريبية
    </v-chip>

    <v-btn
      :icon="ui.darkMode ? 'mdi-weather-sunny' : 'mdi-weather-night'"
      variant="text"
      :title="ui.darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'"
      @click="ui.setDarkMode(!ui.darkMode)"
    />

    <v-menu location="bottom end">
      <template #activator="{ props }">
        <v-btn v-bind="props" variant="text" class="px-2">
          <v-avatar color="primary" size="32" class="me-2">
            <span class="text-caption font-weight-bold">
              {{ initialsOf(auth.user?.fullName ?? '') }}
            </span>
          </v-avatar>
          <span class="d-none d-sm-inline text-body-2">{{ auth.user?.fullName }}</span>
        </v-btn>
      </template>

      <v-list density="compact" min-width="220">
        <v-list-item :title="auth.user?.fullName" :subtitle="auth.user?.email" />
        <v-divider />
        <v-list-item
          :to="{ name: 'profile' }"
          prepend-icon="mdi-account-circle-outline"
          title="حسابي"
        />
        <v-list-item
          prepend-icon="mdi-logout"
          title="تسجيل الخروج"
          :disabled="loggingOut"
          @click="handleLogout"
        />
      </v-list>
    </v-menu>
  </v-app-bar>

  <v-main>
    <v-container fluid class="pa-4 pa-md-6">
      <router-view v-slot="{ Component }">
        <v-fade-transition mode="out-in">
          <component :is="Component" />
        </v-fade-transition>
      </router-view>
    </v-container>
  </v-main>
</template>

<style scoped>
.min-w-0 {
  min-width: 0;
}
</style>
