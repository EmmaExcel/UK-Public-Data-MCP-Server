import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../src/config.js';
import { HttpClient } from '../../src/clients/http-client.js';
import { CompaniesHouseProvider } from '../../src/providers/companies-house-provider.js';
import { createCompaniesHouseToolDefinitions } from '../../src/tools/companies-house.js';
import { createToolContext, jsonResponse } from '../helpers.js';
import companiesHouseFixture from '../fixtures/companies-house.json' with { type: 'json' };

function makeDeps(apiKey?: string) {
  const client = new HttpClient({ timeoutMs: 1000, maxRetries: 1 });
  const ctx = createToolContext();
  const config = loadConfig(apiKey === undefined ? {} : { COMPANIES_HOUSE_API_KEY: apiKey });
  return {
    client,
    ctx,
    definitions: createCompaniesHouseToolDefinitions({
      provider: new CompaniesHouseProvider(client, config),
      ctx,
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Companies House tools', () => {
  it('company_search returns normalized items', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(companiesHouseFixture.search)));
    const { definitions } = makeDeps('test-key');

    const result = await definitions.companySearch.handler({ query: 'example' }, {});
    const envelope = result.structuredContent as {
      data: { items: Array<{ company_number: string; title: string }>; total_results: number };
    };
    expect(envelope.data.items[0].company_number).toBe('12345678');
    expect(envelope.data.total_results).toBe(1);
  });

  it('sends the key as HTTP basic auth with an empty password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(companiesHouseFixture.search));
    vi.stubGlobal('fetch', fetchMock);
    const { definitions } = makeDeps('test-key');

    await definitions.companySearch.handler({ query: 'example' }, {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('test-key:').toString('base64')}`,
    );
  });

  it('company_profile returns normalized profile fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(companiesHouseFixture.profile)));
    const { definitions } = makeDeps('test-key');

    const result = await definitions.companyProfile.handler({ company_number: '12345678' }, {});
    const envelope = result.structuredContent as {
      data: { company_name: string; sic_codes: string[]; jurisdiction: string };
    };
    expect(envelope.data.company_name).toBe('EXAMPLE UK LIMITED');
    expect(envelope.data.sic_codes).toContain('62020');
    expect(envelope.data.jurisdiction).toBe('england-wales');
  });

  it('company_officers returns normalized officer fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(companiesHouseFixture.officers)));
    const { definitions } = makeDeps('test-key');

    const result = await definitions.companyOfficers.handler({ company_number: '12345678' }, {});
    const envelope = result.structuredContent as {
      data: { items: Array<{ name: string; role: string }> };
    };
    expect(envelope.data.items[0].name).toBe('JANE DOE');
    expect(envelope.data.items[0].role).toBe('director');
  });

  it('company_filing_history returns normalized filing items', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(companiesHouseFixture.filing_history)));
    const { definitions } = makeDeps('test-key');

    const result = await definitions.companyFilingHistory.handler({ company_number: '12345678' }, {});
    const envelope = result.structuredContent as {
      data: { items: Array<{ category: string; transaction_id: string }> };
    };
    expect(envelope.data.items[0].category).toBe('confirmation-statement');
    expect(envelope.data.items[0].transaction_id).toBe('MzA0MTAw');
  });

  it('returns CONFIGURATION_ERROR when the Companies House key is missing', async () => {
    const { definitions } = makeDeps();
    const result = await definitions.companyProfile.handler({ company_number: '12345678' }, {});
    const envelope = result.structuredContent as { error: { code: string; retryable: boolean } };
    expect(envelope.error.code).toBe('CONFIGURATION_ERROR');
    expect(envelope.error.retryable).toBe(false);
  });

  it('maps an upstream 404 to NOT_FOUND', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 404 })),
    );
    const { definitions } = makeDeps('test-key');

    const result = await definitions.companyProfile.handler({ company_number: '99999999' }, {});
    const envelope = result.structuredContent as { error: { code: string } };
    expect(envelope.error.code).toBe('NOT_FOUND');
  });

  it('validates Companies House tool input schemas', () => {
    const { definitions } = makeDeps('test-key');
    expect(() => z.object(definitions.companySearch.inputSchema).parse({ query: 'x' })).toThrow();
    expect(() =>
      z.object(definitions.companyProfile.inputSchema).parse({ company_number: 'A' }),
    ).toThrow();
    expect(() =>
      z
        .object(definitions.companyOfficers.inputSchema)
        .parse({ company_number: '12345678', items_per_page: 101 }),
    ).toThrow();
    expect(() =>
      z
        .object(definitions.companyFilingHistory.inputSchema)
        .parse({ company_number: '12345678', start_index: -1 }),
    ).toThrow();
  });
});
