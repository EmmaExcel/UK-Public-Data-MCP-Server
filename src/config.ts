import { z } from 'zod';
import type { UpstreamConfig } from './types.js';

const envBoolean = z.preprocess((value) => {
  if (value === undefined) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}, z.boolean());

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  COMPANIES_HOUSE_API_KEY: z.string().optional(),
  COMPANIES_HOUSE_BASE_URL: z.string().url().default('https://api.company-information.service.gov.uk'),
  ODS_BASE_URL: z.string().url().default('https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations'),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  COMPANIES_HOUSE_RATE_LIMIT_REQUESTS: z.coerce.number().int().nonnegative().default(30),
  POLICE_RATE_LIMIT_REQUESTS: z.coerce.number().int().nonnegative().default(30),
  UPSTREAM_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(4),
  CACHE_ENABLED: envBoolean.default(true),
  POSTCODES_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(86_400_000),
  COMPANIES_HOUSE_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(900_000),
  ODS_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(86_400_000),
  POLICE_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(300_000),
  BANK_HOLIDAYS_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(43_200_000),
});

export type AppConfig = z.infer<typeof configSchema> & UpstreamConfig;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(env);

  return {
    ...parsed,
    httpTimeoutMs: parsed.HTTP_TIMEOUT_MS,
    httpMaxRetries: parsed.HTTP_MAX_RETRIES,
    rateLimitRequests: parsed.RATE_LIMIT_REQUESTS,
    rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    cacheEnabled: parsed.CACHE_ENABLED,
    companiesHouseApiKey: parsed.COMPANIES_HOUSE_API_KEY,
    companiesHouseBaseUrl: parsed.COMPANIES_HOUSE_BASE_URL,
    companiesHouseRateLimitRequests: parsed.COMPANIES_HOUSE_RATE_LIMIT_REQUESTS,
    policeRateLimitRequests: parsed.POLICE_RATE_LIMIT_REQUESTS,
    upstreamConcurrency: parsed.UPSTREAM_CONCURRENCY,
    odsBaseUrl: parsed.ODS_BASE_URL,
    postcodesCacheTtlMs: parsed.POSTCODES_CACHE_TTL_MS,
    companiesHouseCacheTtlMs: parsed.COMPANIES_HOUSE_CACHE_TTL_MS,
    odsCacheTtlMs: parsed.ODS_CACHE_TTL_MS,
    policeCacheTtlMs: parsed.POLICE_CACHE_TTL_MS,
    bankHolidaysCacheTtlMs: parsed.BANK_HOLIDAYS_CACHE_TTL_MS,
  };
}
