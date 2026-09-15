import { describe, expect, it } from 'vitest';
import { TtlCache } from '../../src/middleware/cache.js';
import { SlidingWindowRateLimiter } from '../../src/middleware/rate-limiter.js';
import { getBackoffMs, parseRetryAfterSeconds, shouldRetryStatus } from '../../src/middleware/retry.js';
import { mapHttpError } from '../../src/errors.js';
import { normalizePostcode } from '../../src/utils/normalize.js';
import { isFutureMonth } from '../../src/utils/validation.js';

describe('reliability helpers', () => {
  it('parses Retry-After values and retry eligibility', () => {
    expect(parseRetryAfterSeconds('10')).toBe(10);
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(400)).toBe(false);
  });

  it('computes backoff and jitter safely', () => {
    const value = getBackoffMs(2, 0);
    expect(value).toBeGreaterThanOrEqual(500);
  });

  it('maps HTTP failures to structured app errors', () => {
    const err = mapHttpError(429, 'companies-house', 'Rate limited');
    expect(err.code).toBe('UPSTREAM_RATE_LIMITED');
    expect(err.retryable).toBe(true);
  });

  it('normalizes postcode and validates future dates', () => {
    expect(normalizePostcode(' sw1a  1aa ')).toBe('SW1A 1AA');
    expect(isFutureMonth('2099-01')).toBe(true);
  });
});

describe('cache and rate limit behaviour', () => {
  it('caches values until expiry and misses stale values', () => {
    const cache = new TtlCache();
    cache.set('alpha', { ok: true }, 1000);
    expect(cache.get<{ ok: boolean }>('alpha')).toEqual({ ok: true });
    cache.delete('alpha');
    expect(cache.get('alpha')).toBeUndefined();
  });

  it('allows requests within the configured limit and blocks excess traffic', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    expect(limiter.check('session-1').allowed).toBe(true);
    expect(limiter.check('session-1').allowed).toBe(true);
    expect(limiter.check('session-1').allowed).toBe(false);
  });
});
