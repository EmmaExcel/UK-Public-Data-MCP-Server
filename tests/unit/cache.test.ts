import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../../src/middleware/cache.js';

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns cached values before expiry', () => {
    const cache = new TtlCache();
    cache.set('key', { ok: true }, 1000);
    expect(cache.get<{ ok: boolean }>('key')).toEqual({ ok: true });
    expect(cache.has('key')).toBe(true);
  });

  it('expires entries after the TTL', () => {
    const cache = new TtlCache();
    cache.set('key', 'value', 1000);
    vi.advanceTimersByTime(1001);
    expect(cache.get('key')).toBeUndefined();
    expect(cache.has('key')).toBe(false);
  });

  it('supports delete and clear', () => {
    const cache = new TtlCache();
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    cache.clear();
    expect(cache.get('b')).toBeUndefined();
  });

  it('returns undefined for missing keys', () => {
    const cache = new TtlCache();
    expect(cache.get('missing')).toBeUndefined();
  });
});
