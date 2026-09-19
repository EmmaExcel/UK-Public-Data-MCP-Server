import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HttpClient } from '../../src/clients/http-client.js';
import { PostcodesProvider } from '../../src/providers/postcodes-provider.js';
import { createPostcodeToolDefinitions } from '../../src/tools/postcodes.js';
import { createToolContext, jsonResponse } from '../helpers.js';
import postcodesFixture from '../fixtures/postcodes.json' with { type: 'json' };

function makeDeps() {
  const client = new HttpClient({ timeoutMs: 1000, maxRetries: 1 });
  const ctx = createToolContext();
  return { client, ctx };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('postcode tools', () => {
  it('postcode_lookup returns a normalized success envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(postcodesFixture.postcode_lookup)));
    const { client, ctx } = makeDeps();
    const { postcodeLookup } = createPostcodeToolDefinitions({
      provider: new PostcodesProvider(client),
      ctx,
    });

    const result = await postcodeLookup.handler({ postcode: 'sw1a1aa' }, {});
    const envelope = result.structuredContent as {
      data: { postcode: string; latitude: number };
      meta: { source: string; cached: boolean };
    };

    expect(envelope.data.postcode).toBe('SW1A 1AA');
    expect(envelope.data.latitude).toBe(51.501);
    expect(envelope.meta.source).toBe('postcodes.io');
    expect(envelope.meta.cached).toBe(false);
  });

  it('postcode_nearest normalizes nearby results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(postcodesFixture.postcode_nearest)));
    const { client, ctx } = makeDeps();
    const { postcodeNearest } = createPostcodeToolDefinitions({
      provider: new PostcodesProvider(client),
      ctx,
    });

    const result = await postcodeNearest.handler(
      { latitude: 51.5, longitude: -0.14, limit: 10 },
      {},
    );
    const envelope = result.structuredContent as {
      data: { results: Array<{ postcode: string; distance_m?: number }> };
    };
    expect(envelope.data.results).toHaveLength(2);
    expect(envelope.data.results[0].distance_m).toBe(12);
  });

  it('postcode_search returns search results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(postcodesFixture.postcode_nearest)));
    const { client, ctx } = makeDeps();
    const { postcodeSearch } = createPostcodeToolDefinitions({
      provider: new PostcodesProvider(client),
      ctx,
    });

    const result = await postcodeSearch.handler({ query: 'SW1A' }, {});
    const envelope = result.structuredContent as { data: { results: unknown[] } };
    expect(envelope.data.results.length).toBeGreaterThan(0);
  });

  it('postcode_lookup maps an upstream 404 to a NOT_FOUND envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Postcode not found' }), { status: 404 })),
    );
    const { client, ctx } = makeDeps();
    const { postcodeLookup } = createPostcodeToolDefinitions({
      provider: new PostcodesProvider(client),
      ctx,
    });

    const result = await postcodeLookup.handler({ postcode: 'ZZ99 9ZZ' }, {});
    const envelope = result.structuredContent as { error: { code: string; retryable: boolean } };
    expect(envelope.error.code).toBe('NOT_FOUND');
    expect(envelope.error.retryable).toBe(false);
  });

  it('postcode_lookup retries a 5xx failure and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(postcodesFixture.postcode_lookup));
    vi.stubGlobal('fetch', fetchMock);

    const { client, ctx } = makeDeps();
    const { postcodeLookup } = createPostcodeToolDefinitions({
      provider: new PostcodesProvider(client),
      ctx,
    });

    const result = await postcodeLookup.handler({ postcode: 'SW1A 1AA' }, {});
    const envelope = result.structuredContent as { data: { postcode: string } };
    expect(envelope.data.postcode).toBe('SW1A 1AA');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('validates postcode tool input schemas', () => {
    const { client, ctx } = makeDeps();
    const definitions = createPostcodeToolDefinitions({
      provider: new PostcodesProvider(client),
      ctx,
    });

    expect(() => z.object(definitions.postcodeLookup.inputSchema).parse({ postcode: 'A' })).toThrow();
    expect(() =>
      z.object(definitions.postcodeNearest.inputSchema).parse({ latitude: 91, longitude: 0 }),
    ).toThrow();
    expect(() => z.object(definitions.postcodeSearch.inputSchema).parse({ query: 'x' })).toThrow();
  });
});
