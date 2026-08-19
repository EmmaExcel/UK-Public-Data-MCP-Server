import type { RateLimitDecision } from '../types.js';

export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly limit: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(key: string): RateLimitDecision {
    const now = Date.now();
    const bucket = (this.buckets.get(key) ?? []).filter((timestamp) => now - timestamp < this.windowMs);

    if (bucket.length >= this.limit) {
      const oldest = bucket[0] ?? now;
      const retryAfterMs = Math.max(1, this.windowMs - (now - oldest));
      this.buckets.set(key, bucket);
      return { allowed: false, retryAfterMs };
    }

    bucket.push(now);
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }
}

export interface RateLimitSpec {
  limit: number;
  windowMs: number;
}

export class RateLimiterRegistry {
  private readonly limiters = new Map<string, SlidingWindowRateLimiter>();

  constructor(private readonly specs: Record<string, RateLimitSpec>) {}

  check(scope: string): RateLimitDecision {
    const spec = this.specs[scope];
    if (!spec || spec.limit <= 0) {
      return { allowed: true, retryAfterMs: 0 };
    }

    let limiter = this.limiters.get(scope);
    if (!limiter) {
      limiter = new SlidingWindowRateLimiter(spec.limit, spec.windowMs);
      this.limiters.set(scope, limiter);
    }
    return limiter.check('default');
  }
}
