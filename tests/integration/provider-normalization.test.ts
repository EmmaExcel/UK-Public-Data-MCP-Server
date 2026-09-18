import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { HttpClient } from '../../src/clients/http-client.js';
import { BankHolidaysProvider } from '../../src/providers/bank-holidays-provider.js';
import { CompaniesHouseProvider } from '../../src/providers/companies-house-provider.js';
import { OdsProvider } from '../../src/providers/ods-provider.js';
import { PoliceProvider } from '../../src/providers/police-provider.js';
import { PostcodesProvider } from '../../src/providers/postcodes-provider.js';
import { jsonResponse } from '../helpers.js';

function client() {
  return new HttpClient({ timeoutMs: 1000, maxRetries: 0 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provider normalization with sparse upstream payloads', () => {
  it('postcodes provider tolerates missing optional lookup fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ result: { postcode: 'SW1A1AA', latitude: 51.5, longitude: -0.1 } })),
    );
    const provider = new PostcodesProvider(client());
    const result = await provider.lookup('SW1A 1AA');
    expect(result.region).toBeUndefined();
    expect(result.codes).toBeUndefined();
    expect(result.postcode).toBe('SW1A1AA');
  });

  it('postcodes provider normalizes sparse nearest/search items', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ result: [{ latitude: 51.5, longitude: -0.1 }] })));
    const provider = new PostcodesProvider(client());
    const nearest = await provider.nearest(51.5, -0.1);
    expect(nearest.results[0].postcode).toBe('');
    expect(nearest.results[0].distance_m).toBeUndefined();
  });

  it('companies house provider tolerates sparse records', async () => {
    const config = loadConfig({ COMPANIES_HOUSE_API_KEY: 'test-key' });
    const provider = new CompaniesHouseProvider(client(), config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [{}], total_results: 0 })));
    const search = await provider.search('example');
    expect(search.items[0].company_number).toBe('');
    expect(search.items[0].links).toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ company_number: '1' })));
    const profile = await provider.getProfile('1');
    expect(profile.company_name).toBeUndefined();
    expect(profile.sic_codes).toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [{}] })));
    const officers = await provider.getOfficers('1');
    expect(officers.items[0].name).toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [{}] })));
    const filings = await provider.getFilingHistory('1');
    expect(filings.items[0].filing_date).toBeUndefined();
  });

  it('ods provider handles wrapped and unwrapped organisation payloads', async () => {
    const provider = new OdsProvider(client(), 'https://example.org/ods');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ odsCode: 'RJ1', name: 'Trust' })));
    const lookup = await provider.lookup('RJ1');
    expect(lookup.organisation_name).toBe('Trust');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ Organisations: [{}] })));
    const search = await provider.search('trust');
    expect(search.results).toHaveLength(1);
    expect(search.results[0].ods_code).toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ Organisations: [{}] })));
    const byPostcode = await provider.byPostcode('SW1A 1AA');
    expect(byPostcode.results).toHaveLength(1);
    expect(byPostcode.results[0].postcode).toBeUndefined();
  });

  it('police provider tolerates sparse crime and list payloads', async () => {
    const provider = new PoliceProvider(client(), new PostcodesProvider(client()));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{}])));
    const forces = await provider.getForces();
    expect(forces.forces[0].force_id).toBe('');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{}])));
    const neighbourhoods = await provider.getNeighbourhoods('force');
    expect(neighbourhoods.neighbourhoods[0].id).toBe('');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ outcome_status: null }])));
    const crimes = await provider.getCrimesAtLocation(51.5, -0.1);
    expect(crimes.crimes[0].outcome_status).toBeNull();
    expect(crimes.crimes[0].location).toBeUndefined();
  });

  it('bank holidays provider falls back when a division is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
    const provider = new BankHolidaysProvider(client());
    const division = await provider.getDivision('scotland');
    expect(division.events).toEqual([]);
  });
});
