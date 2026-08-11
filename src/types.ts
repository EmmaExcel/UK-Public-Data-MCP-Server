export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_AUTH_FAILED'
  | 'CONFIGURATION_ERROR'
  | 'INTERNAL_ERROR';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SuccessMeta {
  source: string;
  source_url: string;
  retrieved_at: string;
  cached: boolean;
  request_id: string;
}

export interface ToolSuccessEnvelope<T> {
  data: T;
  meta: SuccessMeta;
}

export interface ToolErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retry_after_seconds: number | null;
  };
  meta: {
    source?: string;
    request_id: string;
  };
}

export interface UpstreamConfig {
  httpTimeoutMs: number;
  httpMaxRetries: number;
  rateLimitRequests: number;
  rateLimitWindowMs: number;
  cacheEnabled: boolean;
  companiesHouseApiKey?: string;
  companiesHouseBaseUrl: string;
  companiesHouseRateLimitRequests: number;
  policeRateLimitRequests: number;
  upstreamConcurrency: number;
  odsBaseUrl: string;
  postcodesCacheTtlMs: number;
  companiesHouseCacheTtlMs: number;
  odsCacheTtlMs: number;
  policeCacheTtlMs: number;
  bankHolidaysCacheTtlMs: number;
}

export interface HttpRequestOptions {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  source?: string;
  allowRetry?: boolean;
  maxRetries?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface ToolRuntimeConfig {
  cacheEnabled: boolean;
  rateLimitRequests: number;
  rateLimitWindowMs: number;
  postcodesCacheTtlMs: number;
  companiesHouseCacheTtlMs: number;
  odsCacheTtlMs: number;
  policeCacheTtlMs: number;
  bankHolidaysCacheTtlMs: number;
}
