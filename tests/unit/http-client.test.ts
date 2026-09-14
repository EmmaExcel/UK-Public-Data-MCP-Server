import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../../src/clients/http-client.js';
import { jsonResponse } from '../helpers.js';

function createClient(overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  return new HttpClient({
    timeoutMs: 5000,
    maxRetries: 1,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HttpClient', () => {
  it('rejects non-HTTPS URLs with CONFIGURATION_ERROR', async () => {
    const client = createClient({ maxRetries: 0 });
    await expect(
      client.request({ url: 'http://example.com/data', source: 'test' }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('sends authorization headers unchanged while redacting only logs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ maxRetries: 0 });
    const result = await client.request<{ ok: boolean }>({
      url: 'https://example.com/data',
      headers: { Authorization: 'Basic abc123', Accept: 'application/json' },
      source: 'companies-house',
    });

    expect(result).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc123');
  });

  it('retries a transient 500 and returns the successful response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const result = await client.request<{ ok: boolean }>({
      url: 'https://example.com/data',
      source: 'test',
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 validation failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ maxRetries: 2 });
    await expect(
      client.request({ url: 'https://example.com/data', source: 'test' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 408 and 429 but not 501', async () => {
    const fetch408 = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 408 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetch408);
    const client408 = createClient();
    await client408.request({ url: 'https://example.com/data', source: 'test' });
    expect(fetch408).toHaveBeenCalledTimes(2);

    const fetch429 = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetch429);
    const client429 = createClient();
    await client429.request({ url: 'https://example.com/data', source: 'test' });
    expect(fetch429).toHaveBeenCalledTimes(2);

    const fetch501 = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 501 }));
    vi.stubGlobal('fetch', fetch501);
    const client501 = createClient({ maxRetries: 2 });
    await expect(
      client501.request({ url: 'https://example.com/data', source: 'test' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', retryable: false });
    expect(fetch501).toHaveBeenCalledTimes(1);
  });

  it('retries network errors for GET but not for POST', async () => {
    const getFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', getFetch);
    const getClient = createClient();
    await getClient.request({ url: 'https://example.com/data', source: 'test', method: 'GET' });
    expect(getFetch).toHaveBeenCalledTimes(2);

    const postFetch = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', postFetch);
    const postClient = createClient();
    await expect(
      postClient.request({ url: 'https://example.com/data', source: 'test', method: 'POST' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(postFetch).toHaveBeenCalledTimes(1);
  });

  it('aborts and retries on timeout, then fails cleanly', async () => {
    const abortableFetch = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted', 'AbortError')),
        );
      });
    });
    vi.stubGlobal('fetch', abortableFetch);

    const client = createClient({ timeoutMs: 10, maxRetries: 1 });
    await expect(
      client.request({ url: 'https://example.com/data', source: 'test' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(abortableFetch).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit breaker after repeated failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ maxRetries: 0 });
    for (let i = 0; i < 5; i += 1) {
      await expect(
        client.request({ url: 'https://example.com/data', source: 'test' }),
      ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    }

    await expect(
      client.request({ url: 'https://example.com/data', source: 'test' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', message: expect.stringContaining('Circuit breaker') });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('enforces source-specific throttles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({
      maxRetries: 0,
      sourceRateLimits: { 'companies-house': { limit: 1, windowMs: 60_000 } },
    });

    await client.request({ url: 'https://example.com/data', source: 'companies-house' });
    await expect(
      client.request({ url: 'https://example.com/data', source: 'companies-house' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_RATE_LIMITED', retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
