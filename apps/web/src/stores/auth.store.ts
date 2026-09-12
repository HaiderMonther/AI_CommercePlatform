import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authService } from '@/services/auth.service';
import { registerAuthBridge } from '@/services/http';
import type { AuthCompany, AuthTokens, AuthUser, LoginPayload, RegisterPayload } from '@/types/auth';

const ACCESS_TOKEN_KEY = 'aicp.accessToken';
const REFRESH_TOKEN_KEY = 'aicp.refreshToken';

/**
 * Tokens live in localStorage so a refresh keeps the session. The access token is
 * short-lived and the refresh token is single-use and rotated server-side, which limits
 * what a stolen copy is worth. Moving to httpOnly cookies is tracked for Phase 9.
 */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Private browsing or blocked storage: the session simply does not survive a reload.
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const company = ref<AuthCompany | null>(null);
  const accessToken = ref<string | null>(readStorage(ACCESS_TOKEN_KEY));
  const refreshToken = ref<string | null>(readStorage(REFRESH_TOKEN_KEY));
  const initializing = ref(false);
  const sessionExpired = ref(false);

  const isAuthenticated = computed(() => Boolean(accessToken.value && user.value));
  const permissions = computed(() => new Set(user.value?.permissions ?? []));
  const currency = computed(() => company.value?.currency ?? 'IQD');

  function can(permission: string | string[]): boolean {
    if (!user.value) return false;
    if (user.value.isPlatformAdmin) return true;

    const required = Array.isArray(permission) ? permission : [permission];
    return required.every((key) => permissions.value.has(key));
  }

  function canAny(candidates: string[]): boolean {
    if (!user.value) return false;
    if (user.value.isPlatformAdmin) return true;
    return candidates.some((key) => permissions.value.has(key));
  }

  function setTokens(tokens: AuthTokens | null): void {
    accessToken.value = tokens?.accessToken ?? null;
    refreshToken.value = tokens?.refreshToken ?? null;
    writeStorage(ACCESS_TOKEN_KEY, accessToken.value);
    writeStorage(REFRESH_TOKEN_KEY, refreshToken.value);
  }

  function setSession(payload: { user: AuthUser; company: AuthCompany | null; tokens?: AuthTokens }) {
    user.value = payload.user;
    company.value = payload.company;
    if (payload.tokens) {
      setTokens(payload.tokens);
    }
    sessionExpired.value = false;
  }

  function clear(): void {
    user.value = null;
    company.value = null;
    setTokens(null);
  }

  async function login(payload: LoginPayload): Promise<void> {
    setSession(await authService.login(payload));
  }

  async function register(payload: RegisterPayload): Promise<void> {
    setSession(await authService.register(payload));
  }

  async function logout(): Promise<void> {
    try {
      if (accessToken.value) {
        await authService.logout(refreshToken.value);
      }
    } catch {
      // Logging out locally must succeed even if the API call fails.
    } finally {
      clear();
    }
  }

  /** Restores the session on a hard page load; returns false when the token is dead. */
  async function initialize(): Promise<boolean> {
    if (!accessToken.value) return false;
    if (user.value) return true;

    initializing.value = true;
    try {
      const profile = await authService.me();
      user.value = profile.user;
      company.value = profile.company;
      return true;
    } catch {
      const refreshed = await refreshSession();
      return Boolean(refreshed);
    } finally {
      initializing.value = false;
    }
  }

  async function refreshSession(): Promise<string | null> {
    if (!refreshToken.value) {
      clear();
      return null;
    }

    try {
      const session = await authService.refresh(refreshToken.value);
      setSession(session);
      return session.tokens.accessToken;
    } catch {
      clear();
      sessionExpired.value = true;
      return null;
    }
  }

  function onSessionExpired(): void {
    clear();
    sessionExpired.value = true;
  }

  registerAuthBridge({
    getAccessToken: () => accessToken.value,
    refreshSession,
    onSessionExpired,
  });

  return {
    user,
    company,
    accessToken,
    refreshToken,
    initializing,
    sessionExpired,
    isAuthenticated,
    currency,
    can,
    canAny,
    login,
    register,
    logout,
    initialize,
    refreshSession,
    clear,
  };
});
