import type { RouteRecordRaw } from 'vue-router';
import { PERMISSIONS } from '@/constants/permissions';

/**
 * `meta.permissions` mirrors the API guard so the UI hides what the user cannot do.
 * The API remains the enforcement point — this only avoids dead ends in the interface.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/auth',
    component: () => import('@/layouts/AuthLayout.vue'),
    meta: { guestOnly: true },
    children: [
      {
        path: 'login',
        name: 'login',
        component: () => import('@/views/auth/LoginView.vue'),
        meta: { title: 'تسجيل الدخول' },
      },
      {
        path: 'register',
        name: 'register',
        component: () => import('@/views/auth/RegisterView.vue'),
        meta: { title: 'إنشاء حساب جديد' },
      },
    ],
  },
  {
    path: '/',
    component: () => import('@/layouts/DashboardLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: 'لوحة التحكم', icon: 'mdi-view-dashboard-outline' },
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/views/settings/UsersView.vue'),
        meta: {
          title: 'المستخدمون',
          icon: 'mdi-account-group-outline',
          permissions: [PERMISSIONS.USERS_READ],
        },
      },
      {
        path: 'roles',
        name: 'roles',
        component: () => import('@/views/settings/RolesView.vue'),
        meta: {
          title: 'الأدوار والصلاحيات',
          icon: 'mdi-shield-key-outline',
          permissions: [PERMISSIONS.ROLES_READ],
        },
      },
      {
        path: 'settings/company',
        name: 'company-settings',
        component: () => import('@/views/settings/CompanySettingsView.vue'),
        meta: {
          title: 'إعدادات الشركة',
          icon: 'mdi-store-cog-outline',
          permissions: [PERMISSIONS.COMPANY_READ],
        },
      },
      {
        path: 'settings/profile',
        name: 'profile',
        component: () => import('@/views/settings/ProfileView.vue'),
        meta: { title: 'حسابي', icon: 'mdi-account-circle-outline' },
      },
      {
        path: 'audit-logs',
        name: 'audit-logs',
        component: () => import('@/views/settings/AuditLogsView.vue'),
        meta: {
          title: 'سجل العمليات',
          icon: 'mdi-clipboard-text-clock-outline',
          permissions: [PERMISSIONS.AUDIT_READ],
        },
      },
    ],
  },
  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/views/errors/ForbiddenView.vue'),
    meta: { title: 'غير مصرح' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/errors/NotFoundView.vue'),
    meta: { title: 'الصفحة غير موجودة' },
  },
];
