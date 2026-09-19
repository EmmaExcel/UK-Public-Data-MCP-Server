import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HttpClient } from '../../src/clients/http-client.js';
import { OdsProvider } from '../../src/providers/ods-provider.js';
import { createOdsToolDefinitions } from '../../src/tools/ods.js';
import { createToolContext, jsonResponse } from '../helpers.js';
import odsFixture from '../fixtures/ods.json' with { type: 'json' };

function makeDeps() {
  const client = new HttpClient({ timeoutMs: 1000, maxRetries: 1 });
  const ctx = createToolContext();
  return {
    client,
    ctx,
    definitions: createOdsToolDefinitions({
      provider: new OdsProvider(client, 'https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations'),
      ctx,
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NHS ODS tools', () => {
  it('ods_organisation_lookup returns normalized organisation data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(odsFixture.lookup)));
    const { definitions } = makeDeps();

    const result = await definitions.odsOrganisationLookup.handler({ ods_code: 'RJ1' }, {});
    const envelope = result.structuredContent as {
      data: { ods_code: string; organisation_name: string; postcode: string };
    };
    expect(envelope.data.ods_code).toBe('RJ1');
    expect(envelope.data.organisation_name).toBe('EXAMPLE NHS TRUST');
    expect(envelope.data.postcode).toBe('SW1A 1AA');
  });

  it('ods_organisation_search returns matching organisations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(odsFixture.search)));
    const { definitions } = makeDeps();

    const result = await definitions.odsOrganisationSearch.handler({ query: 'example' }, {});
    const envelope = result.structuredContent as {
      data: { results: Array<{ ods_code: string }> };
    };
    expect(envelope.data.results).toHaveLength(1);
    expect(envelope.data.results[0].ods_code).toBe('RJ1');
  });

  it('ods_organisations_by_postcode normalizes the postcode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(odsFixture.by_postcode)));
    const { definitions } = makeDeps();

    const result = await definitions.odsOrganisationsByPostcode.handler(
      { postcode: 'sw1a1aa' },
      {},
    );
    const envelope = result.structuredContent as {
      data: { results: Array<{ postcode: string }> };
    };
    expect(envelope.data.results[0].postcode).toBe('SW1A 1AA');
  });

  it('maps upstream 404 to NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    const { definitions } = makeDeps();

    const result = await definitions.odsOrganisationLookup.handler({ ods_code: 'ZZZ' }, {});
    const envelope = result.structuredContent as { error: { code: string } };
    expect(envelope.error.code).toBe('NOT_FOUND');
  });

  it('validates ODS tool input schemas', () => {
    const { definitions } = makeDeps();
    expect(() =>
      z.object(definitions.odsOrganisationLookup.inputSchema).parse({ ods_code: 'A' }),
    ).toThrow();
    expect(() =>
      z.object(definitions.odsOrganisationSearch.inputSchema).parse({ query: 'x' }),
    ).toThrow();
    expect(() =>
      z.object(definitions.odsOrganisationsByPostcode.inputSchema).parse({ postcode: 'A' }),
    ).toThrow();
  });
});
