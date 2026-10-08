import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { ERROR_CODE_LABELS } from '@/constants/labels';
import { ApiEnvelope, ApiError } from '@/types/api';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

type RetriableRequest = InternalAxiosRequestConfig & { _retried?: boolean };

/** Injected by the auth store at startup to avoid a circular import. */
interface AuthBridge {
  getAccessToken: () => string | null;
  refreshSession: () => Promise<string | null>;
  onSessionExpired: () => void;
}

let authBridge: AuthBridge | null = null;

export function registerAuthBridge(bridge: AuthBridge): void {
  authBridge = bridge;
}

export const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const token = authBridge?.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * A single in-flight refresh shared by every queued request: without this, a page that
 * fires five requests on load would trigger five rotations and trip the API's
 * refresh-token reuse detection.
 */
let refreshPromise: Promise<string | null> | null = null;

/** Shared with the realtime client, which also needs fresh tokens after expiry. */
export function refreshAccessToken(): Promise<string | null> {
  if (!authBridge) return Promise.resolve(null);

  refreshPromise ??= authBridge.refreshSession().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope<null>>) => {
    const original = error.config as RetriableRequest | undefined;
    const status = error.response?.status;
    const code = error.response?.data?.code;

    const isExpiredSession = status === 401 && code === 'TOKEN_EXPIRED';
    const canRetry = original && !original._retried && !original.url?.includes('/auth/');

    if (isExpiredSession && canRetry && authBridge) {
      original._retried = true;

      const token = await refreshAccessToken();

      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return http(original);
      }
    }

    if (status === 401 && !original?.url?.includes('/auth/login')) {
      authBridge?.onSessionExpired();
    }

    throw toApiError(error);
  },
);

function toApiError(error: AxiosError<ApiEnvelope<null>>): ApiError {
  if (!error.response) {
    return new ApiError(ERROR_CODE_LABELS.NETWORK_ERROR, 'NETWORK_ERROR', 0);
  }

  const body = error.response.data;
  const code = body?.code ?? 'INTERNAL_ERROR';

  return new ApiError(
    body?.message ?? ERROR_CODE_LABELS[code] ?? 'حدث خطأ غير متوقع',
    code,
    error.response.status,
    body?.details,
    body?.correlationId,
  );
}

/** Unwraps the API envelope so callers work with the payload directly. */
export async function unwrap<T>(request: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  const response = await request;
  return response.data.data;
}
