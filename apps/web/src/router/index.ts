import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { routes } from './routes';

const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'منصة المبيعات الذكية';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  // A hard reload arrives with a token but no user; restore the session once.
  if (!auth.isAuthenticated && auth.accessToken) {
    await auth.initialize();
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath === '/' ? undefined : { redirect: to.fullPath } };
  }

  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: 'dashboard' };
  }

  const required = to.meta.permissions as string[] | undefined;
  if (required?.length && !auth.can(required)) {
    return { name: 'forbidden' };
  }

  return true;
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
});
