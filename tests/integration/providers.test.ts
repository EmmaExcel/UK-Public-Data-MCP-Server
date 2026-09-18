import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../../src/clients/http-client.js';
import { BankHolidaysProvider } from '../../src/providers/bank-holidays-provider.js';
import { PoliceProvider } from '../../src/providers/police-provider.js';
import { PostcodesProvider } from '../../src/providers/postcodes-provider.js';
import { jsonResponse } from '../helpers.js';
import bankHolidaysFixture from '../fixtures/bank-holidays.json' with { type: 'json' };
import policeFixture from '../fixtures/police.json' with { type: 'json' };
import postcodesFixture from '../fixtures/postcodes.json' with { type: 'json' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provider integration with mocked upstream responses', () => {
  it('normalizes a postcode lookup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(postcodesFixture.postcode_lookup)));
    const provider = new PostcodesProvider(new HttpClient({ timeoutMs: 1000, maxRetries: 1 }));

    const result = await provider.lookup('SW1A1AA');
    expect(result.postcode).toBe('SW1A 1AA');
    expect(result.local_authority).toBe('Westminster');
    expect(result.codes).toEqual({ admin_district: 'E09000033' });
  });

  it('throws NOT_FOUND when a postcode has no result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ result: null })));
    const provider = new PostcodesProvider(new HttpClient({ timeoutMs: 1000, maxRetries: 1 }));

    await expect(provider.lookup('ZZ99 9ZZ')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns full police results for getCrimesByPostcode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(postcodesFixture.postcode_lookup))
      .mockResolvedValueOnce(jsonResponse(policeFixture.crimes));
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient({ timeoutMs: 1000, maxRetries: 1 });
    const provider = new PoliceProvider(client, new PostcodesProvider(client));

    const result = await provider.getCrimesByPostcode('SW1A 1AA', '2026-01');
    expect(result.partial).toBe(false);
    expect(result.crimes?.[0]?.category).toBe('anti-social-behaviour');
  });

  it('maps postcode resolution failure to NOT_FOUND in partial police flow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ result: null })));

    const client = new HttpClient({ timeoutMs: 1000, maxRetries: 1 });
    const provider = new PoliceProvider(client, new PostcodesProvider(client));

    await expect(provider.getCrimesByPostcodeWithPartial('ZZ99 9ZZ')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('exposes raw bank holiday data and normalized event fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(bankHolidaysFixture)));
    const provider = new BankHolidaysProvider(new HttpClient({ timeoutMs: 1000, maxRetries: 1 }));

    const all = await provider.getAll();
    expect(all['england-and-wales']).toBeTruthy();

    const division = await provider.getDivision('england-and-wales', 2026);
    expect(division.events).toHaveLength(3);

    const fields = provider.getBankHolidayEventFields({
      title: 'Christmas Day',
      date: '2026-12-25',
      notes: '',
      bunting: true,
    });
    expect(fields.title).toBe('Christmas Day');
    expect(fields.bunting).toBe(true);
  });
});
