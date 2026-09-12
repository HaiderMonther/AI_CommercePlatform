/** Mirrors the uniform envelope returned by the API. */
export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  code?: string;
  details?: string[];
  correlationId?: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Normalized error thrown by the HTTP client so views never touch Axios internals. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: string[],
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
