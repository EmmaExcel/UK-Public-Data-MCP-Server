import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiterRegistry, SlidingWindowRateLimiter } from '../../src/middleware/rate-limiter.js';

describe('SlidingWindowRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the limit and blocks excess traffic', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    expect(limiter.check('client').allowed).toBe(true);
    expect(limiter.check('client').allowed).toBe(true);
    expect(limiter.check('client').allowed).toBe(false);
  });

  it('does not count denied requests against the window', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    limiter.check('client');
    limiter.check('client');
    const denied = limiter.check('client');
    expect(denied.allowed).toBe(false);
    const stillDenied = limiter.check('client');
    expect(stillDenied.allowed).toBe(false);
    expect(limiter.check('other-client').allowed).toBe(true);
  });

  it('returns a retry-after value based on the oldest request', () => {
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    limiter.check('client');
    const decision = limiter.check('client');
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBeGreaterThan(0);
    expect(decision.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('expires old requests and allows traffic again', () => {
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    expect(limiter.check('client').allowed).toBe(true);
    expect(limiter.check('client').allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(limiter.check('client').allowed).toBe(true);
  });
});

describe('RateLimiterRegistry', () => {
  it('uses per-source specs and treats unknown sources as unlimited', () => {
    const registry = new RateLimiterRegistry({
      'companies-house': { limit: 1, windowMs: 1000 },
    });
    expect(registry.check('companies-house').allowed).toBe(true);
    expect(registry.check('companies-house').allowed).toBe(false);
    expect(registry.check('unknown-source').allowed).toBe(true);
  });

  it('ignores specs with a non-positive limit', () => {
    const registry = new RateLimiterRegistry({
      'companies-house': { limit: 0, windowMs: 1000 },
    });
    expect(registry.check('companies-house').allowed).toBe(true);
  });
});
