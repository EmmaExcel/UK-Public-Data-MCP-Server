import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/errors.js';
import { TtlCache } from '../../src/middleware/cache.js';
import { SlidingWindowRateLimiter } from '../../src/middleware/rate-limiter.js';
import {
  buildCacheKey,
  errorEnvelope,
  runTool,
  successEnvelope,
  toolResult,
} from '../../src/tools/shared.js';
import { createToolContext } from '../helpers.js';

describe('successEnvelope and toolResult', () => {
  it('builds a success envelope with metadata', () => {
    const envelope = successEnvelope({ ok: true }, 'postcodes.io', 'https://example.com', false);
    expect(envelope.meta.source).toBe('postcodes.io');
    expect(envelope.meta.source_url).toBe('https://example.com');
    expect(envelope.meta.cached).toBe(false);
    expect(envelope.meta.request_id).toBeTruthy();
    expect(envelope.meta.retrieved_at).toBeTruthy();

    const result = toolResult(envelope);
    const content = result.content[0] as { type: string; text: string };
    expect(content.type).toBe('text');
    expect(JSON.parse(content.text)).toEqual(envelope);
  });
});

describe('errorEnvelope', () => {
  it('maps AppError with code, retryable and retry-after fields', () => {
    const envelope = errorEnvelope(
      new AppError('UPSTREAM_RATE_LIMITED', 'Rate limited.', { retryable: true, retryAfterSeconds: 3 }),
      'companies-house',
    );
    expect(envelope.error.code).toBe('UPSTREAM_RATE_LIMITED');
    expect(envelope.error.retryable).toBe(true);
    expect(envelope.error.retry_after_seconds).toBe(3);
  });

  it('sanitizes and maps unknown errors to INTERNAL_ERROR', () => {
    const envelope = errorEnvelope(new Error('api_key=leak'), 'postcodes.io');
    expect(envelope.error.code).toBe('INTERNAL_ERROR');
    expect(envelope.error.message).toBe('api_key=[REDACTED]');
  });
});

describe('buildCacheKey', () => {
  it('is stable regardless of object key order', () => {
    expect(buildCacheKey('tool', { a: 1, b: 2 })).toBe(buildCacheKey('tool', { b: 2, a: 1 }));
  });

  it('separates tools and arguments', () => {
    expect(buildCacheKey('alpha', { x: 1 })).not.toBe(buildCacheKey('beta', { x: 1 }));
  });
});

describe('runTool', () => {
  it('returns a success envelope and caches the handler result', async () => {
    const ctx = createToolContext();
    const handler = vi.fn().mockResolvedValue({ data: { ok: true }, source_url: 'https://example.com' });

    const first = await runTool({
      toolName: 'test_tool',
      source: 'postcodes.io',
      args: { id: 'abc' },
      ttlMs: 60_000,
      ctx,
      handler,
    });
    const second = await runTool({
      toolName: 'test_tool',
      source: 'postcodes.io',
      args: { id: 'abc' },
      ttlMs: 60_000,
      ctx,
      handler,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const firstEnvelope = first.structuredContent as { meta: { cached: boolean } };
    const secondEnvelope = second.structuredContent as { meta: { cached: boolean } };
    expect(firstEnvelope.meta.cached).toBe(false);
    expect(secondEnvelope.meta.cached).toBe(true);
  });

  it('does not cache failed responses', async () => {
    const ctx = createToolContext();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new AppError('NOT_FOUND', 'No company found.', { retryable: false }))
      .mockResolvedValueOnce({ data: { ok: true }, source_url: 'https://example.com' });

    const first = await runTool({
      toolName: 'test_tool',
      source: 'companies-house',
      args: { company_number: '1' },
      ttlMs: 60_000,
      ctx,
      handler,
    });
    const second = await runTool({
      toolName: 'test_tool',
      source: 'companies-house',
      args: { company_number: '1' },
      ttlMs: 60_000,
      ctx,
      handler,
    });

    const firstEnvelope = first.structuredContent as { error: { code: string } };
    expect(firstEnvelope.error.code).toBe('NOT_FOUND');
    expect(handler).toHaveBeenCalledTimes(2);
    const secondEnvelope = second.structuredContent as { meta: { cached: boolean } };
    expect(secondEnvelope.meta.cached).toBe(false);
  });

  it('respects cacheable: false', async () => {
    const ctx = createToolContext();
    const handler = vi.fn().mockResolvedValue({ data: { ok: true }, source_url: 'https://example.com' });

    for (let i = 0; i < 2; i += 1) {
      await runTool({
        toolName: 'test_tool',
        source: 'police.uk',
        args: { id: 'abc' },
        ttlMs: 60_000,
        ctx,
        cacheable: false,
        handler,
      });
    }

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('returns a structured rate-limit error when the client is throttled', async () => {
    const cache = new TtlCache();
    const rateLimiter = new SlidingWindowRateLimiter(1, 60_000);
    const ctx = {
      cache,
      rateLimiter,
      config: {
        cacheEnabled: true,
        rateLimitRequests: 1,
        rateLimitWindowMs: 60_000,
        postcodesCacheTtlMs: 1,
        companiesHouseCacheTtlMs: 1,
        odsCacheTtlMs: 1,
        policeCacheTtlMs: 1,
        bankHolidaysCacheTtlMs: 1,
      },
    };
    const handler = vi.fn().mockResolvedValue({ data: { ok: true }, source_url: 'https://example.com' });

    const options = {
      toolName: 'test_tool',
      source: 'postcodes.io',
      args: {},
      ttlMs: 60_000,
      ctx,
      handler,
    };

    const first = await runTool(options);
    const second = await runTool(options);

    const firstEnvelope = first.structuredContent as { meta: { cached: boolean } };
    expect(firstEnvelope.meta.cached).toBe(false);
    const secondEnvelope = second.structuredContent as {
      error: { code: string; retryable: boolean; retry_after_seconds: number | null };
    };
    expect(secondEnvelope.error.code).toBe('UPSTREAM_RATE_LIMITED');
    expect(secondEnvelope.error.retryable).toBe(true);
    expect(secondEnvelope.error.retry_after_seconds).toBeGreaterThan(0);
  });

  it('uses session id for the rate-limit scope when available', async () => {
    const ctx = createToolContext({ rateLimitRequests: 1 });
    const handler = vi.fn().mockResolvedValue({ data: {}, source_url: 'https://example.com' });

    await runTool({
      toolName: 'test_tool',
      source: 'postcodes.io',
      args: {},
      ttlMs: 0,
      ctx,
      sessionId: 'session-a',
      handler,
    });
    const other = await runTool({
      toolName: 'test_tool',
      source: 'postcodes.io',
      args: {},
      ttlMs: 0,
      ctx,
      sessionId: 'session-b',
      handler,
    });

    const otherEnvelope = other.structuredContent as { meta: { cached: boolean } };
    expect(otherEnvelope.meta.cached).toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
