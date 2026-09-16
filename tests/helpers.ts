import { TtlCache } from '../src/middleware/cache.js';
import { SlidingWindowRateLimiter } from '../src/middleware/rate-limiter.js';
import type { ToolExecutionContext } from '../src/tools/shared.js';
import type { ToolRuntimeConfig } from '../src/types.js';

export function createToolContext(
  overrides: Partial<ToolRuntimeConfig> = {},
): ToolExecutionContext {
  const config: ToolRuntimeConfig = {
    cacheEnabled: true,
    rateLimitRequests: 60,
    rateLimitWindowMs: 60_000,
    postcodesCacheTtlMs: 86_400_000,
    companiesHouseCacheTtlMs: 900_000,
    odsCacheTtlMs: 86_400_000,
    policeCacheTtlMs: 300_000,
    bankHolidaysCacheTtlMs: 43_200_000,
    ...overrides,
  };
  return {
    cache: new TtlCache(),
    rateLimiter: new SlidingWindowRateLimiter(config.rateLimitRequests, config.rateLimitWindowMs),
    config,
  };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
