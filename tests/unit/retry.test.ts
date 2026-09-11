import { describe, expect, it } from 'vitest';
import { getBackoffMs, MAX_BACKOFF_MS, parseRetryAfterSeconds, shouldRetryStatus } from '../../src/middleware/retry.js';

describe('shouldRetryStatus', () => {
  it('retries only the transient status list', () => {
    expect(shouldRetryStatus(408)).toBe(true);
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(500)).toBe(true);
    expect(shouldRetryStatus(502)).toBe(true);
    expect(shouldRetryStatus(503)).toBe(true);
    expect(shouldRetryStatus(504)).toBe(true);
    expect(shouldRetryStatus(400)).toBe(false);
    expect(shouldRetryStatus(401)).toBe(false);
    expect(shouldRetryStatus(404)).toBe(false);
    expect(shouldRetryStatus(501)).toBe(false);
  });
});

describe('parseRetryAfterSeconds', () => {
  it('parses numeric values', () => {
    expect(parseRetryAfterSeconds('10')).toBe(10);
    expect(parseRetryAfterSeconds('0')).toBe(0);
  });

  it('parses HTTP dates relative to now', () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const parsed = parseRetryAfterSeconds(future);
    expect(parsed).toBeGreaterThanOrEqual(29);
    expect(parsed).toBeLessThanOrEqual(31);
  });

  it('returns null for missing or invalid values', () => {
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds(undefined)).toBeNull();
    expect(parseRetryAfterSeconds('not-a-date')).toBeNull();
  });
});

describe('getBackoffMs', () => {
  it('honours Retry-After when provided', () => {
    expect(getBackoffMs(1, 3)).toBe(3000);
  });

  it('caps extremely large Retry-After values', () => {
    expect(getBackoffMs(1, 1_000_000)).toBe(MAX_BACKOFF_MS);
  });

  it('uses exponential backoff with jitter for attempt one', () => {
    const value = getBackoffMs(1, null);
    expect(value).toBeGreaterThanOrEqual(250);
    expect(value).toBeLessThanOrEqual(449);
  });

  it('doubles base delay on later attempts', () => {
    const value = getBackoffMs(3, 0);
    expect(value).toBeGreaterThanOrEqual(1000);
    expect(value).toBeLessThanOrEqual(1199);
  });
});
