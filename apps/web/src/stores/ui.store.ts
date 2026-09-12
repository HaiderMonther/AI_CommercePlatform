import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  timeout: number;
}

const THEME_KEY = 'aicp.theme';
const RAIL_KEY = 'aicp.rail';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore blocked storage; the preference just resets next visit.
  }
}

let nextToastId = 1;

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([]);
  const drawerOpen = ref(true);
  const railMode = ref(readBool(RAIL_KEY, false));
  const darkMode = ref(readBool(THEME_KEY, false));

  function notify(message: string, kind: ToastKind = 'info', timeout = 4000): void {
    const toast: Toast = { id: nextToastId++, kind, message, timeout };
    toasts.value.push(toast);
    window.setTimeout(() => dismiss(toast.id), timeout);
  }

  const success = (message: string) => notify(message, 'success');
  const error = (message: string) => notify(message, 'error', 6000);
  const warning = (message: string) => notify(message, 'warning');

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function toggleDrawer(): void {
    drawerOpen.value = !drawerOpen.value;
  }

  function toggleRail(): void {
    railMode.value = !railMode.value;
    persist(RAIL_KEY, String(railMode.value));
  }

  function setDarkMode(value: boolean): void {
    darkMode.value = value;
    persist(THEME_KEY, String(value));
  }

  return {
    toasts,
    drawerOpen,
    railMode,
    darkMode,
    notify,
    success,
    error,
    warning,
    dismiss,
    toggleDrawer,
    toggleRail,
    setDarkMode,
  };
});
