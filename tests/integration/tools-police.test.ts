import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HttpClient } from '../../src/clients/http-client.js';
import { PoliceProvider } from '../../src/providers/police-provider.js';
import { PostcodesProvider } from '../../src/providers/postcodes-provider.js';
import { createPoliceToolDefinitions } from '../../src/tools/police.js';
import { createToolContext, jsonResponse } from '../helpers.js';
import policeFixture from '../fixtures/police.json' with { type: 'json' };
import postcodesFixture from '../fixtures/postcodes.json' with { type: 'json' };

function makeDeps() {
  const client = new HttpClient({ timeoutMs: 1000, maxRetries: 1 });
  const ctx = createToolContext();
  const postcodesProvider = new PostcodesProvider(client);
  return {
    client,
    ctx,
    definitions: createPoliceToolDefinitions({
      provider: new PoliceProvider(client, postcodesProvider),
      ctx,
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('police.uk tools', () => {
  it('police_forces returns forces', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(policeFixture.forces)));
    const { definitions } = makeDeps();

    const result = await definitions.policeForces.handler({}, {});
    const envelope = result.structuredContent as {
      data: { forces: Array<{ force_id: string; name: string }> };
    };
    expect(envelope.data.forces).toHaveLength(2);
    expect(envelope.data.forces[0].force_id).toBe('city-of-london');
  });

  it('police_neighbourhoods returns neighbourhoods', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(policeFixture.neighbourhoods)));
    const { definitions } = makeDeps();

    const result = await definitions.policeNeighbourhoods.handler({ force_id: 'metropolitan' }, {});
    const envelope = result.structuredContent as {
      data: { neighbourhoods: Array<{ id: string; name: string }> };
    };
    expect(envelope.data.neighbourhoods[0].id).toBe('neighbourhood-1');
  });

  it('police_crimes_at_location normalizes crimes and includes a privacy note', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(policeFixture.crimes)));
    const { definitions } = makeDeps();

    const result = await definitions.policeCrimesAtLocation.handler(
      { latitude: 51.5, longitude: -0.14, date: '2026-01' },
      {},
    );
    const envelope = result.structuredContent as {
      data: {
        crimes: Array<{ category: string; persistent_id: string; outcome_status: string | null }>;
        privacy_note: string;
      };
    };
    expect(envelope.data.crimes[0].category).toBe('anti-social-behaviour');
    expect(envelope.data.crimes[0].outcome_status).toBe('Under investigation');
    expect(envelope.data.privacy_note).toContain('anonymised');
  });

  it('police_crimes_by_postcode returns a partial result when police lookup fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(postcodesFixture.postcode_lookup))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const { definitions } = makeDeps();
    const result = await definitions.policeCrimesByPostcode.handler({ postcode: 'SW1A 1AA' }, {});
    const envelope = result.structuredContent as {
      data: { partial: boolean; resolved_postcode: string; error?: string };
    };
    expect(envelope.data.partial).toBe(true);
    expect(envelope.data.resolved_postcode).toBe('SW1A 1AA');
    expect(envelope.data.error).toBeTruthy();
  });

  it('police_crimes_by_postcode returns full results on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(postcodesFixture.postcode_lookup))
      .mockResolvedValueOnce(jsonResponse(policeFixture.crimes));
    vi.stubGlobal('fetch', fetchMock);

    const { definitions } = makeDeps();
    const result = await definitions.policeCrimesByPostcode.handler({ postcode: 'SW1A 1AA' }, {});
    const envelope = result.structuredContent as {
      data: { partial: boolean; crimes: Array<{ category: string }> };
    };
    expect(envelope.data.partial).toBe(false);
    expect(envelope.data.crimes[0].category).toBe('anti-social-behaviour');
  });

  it('validates police tool input schemas', () => {
    const { definitions } = makeDeps();
    expect(() =>
      z.object(definitions.policeCrimesAtLocation.inputSchema).parse({ latitude: 91, longitude: 0 }),
    ).toThrow();
    expect(() =>
      z.object(definitions.policeCrimesAtLocation.inputSchema).parse({
        latitude: 0,
        longitude: 0,
        date: '2099-01',
      }),
    ).toThrow();
    expect(() =>
      z.object(definitions.policeCrimesByPostcode.inputSchema).parse({ postcode: 'A' }),
    ).toThrow();
  });
});
