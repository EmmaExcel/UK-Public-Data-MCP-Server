import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HttpClient } from '../../src/clients/http-client.js';
import { BankHolidaysProvider } from '../../src/providers/bank-holidays-provider.js';
import { createBankHolidaysToolDefinitions } from '../../src/tools/bank-holidays.js';
import { createToolContext, jsonResponse } from '../helpers.js';
import bankHolidaysFixture from '../fixtures/bank-holidays.json' with { type: 'json' };

function makeDeps() {
  const client = new HttpClient({ timeoutMs: 1000, maxRetries: 1 });
  const ctx = createToolContext();
  return {
    client,
    ctx,
    definitions: createBankHolidaysToolDefinitions({
      provider: new BankHolidaysProvider(client),
      ctx,
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bank holiday tools', () => {
  it('bank_holidays returns events for a division', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(bankHolidaysFixture)));
    const { definitions } = makeDeps();

    const result = await definitions.bankHolidays.handler({ division: 'england-and-wales' }, {});
    const envelope = result.structuredContent as {
      data: { division: string; events: Array<{ title: string }> };
    };
    expect(envelope.data.division).toBe('england-and-wales');
    expect(envelope.data.events).toHaveLength(3);
  });

  it('bank_holidays filters locally by year', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(bankHolidaysFixture)));
    const { definitions } = makeDeps();

    const result = await definitions.bankHolidays.handler(
      { division: 'england-and-wales', year: 2027 },
      {},
    );
    const envelope = result.structuredContent as { data: { events: unknown[] } };
    expect(envelope.data.events).toHaveLength(0);
  });

  it('next_bank_holiday returns the next event on or after from_date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(bankHolidaysFixture)));
    const { definitions } = makeDeps();

    const result = await definitions.nextBankHoliday.handler(
      { division: 'england-and-wales', from_date: '2026-04-01' },
      {},
    );
    const envelope = result.structuredContent as {
      data: { next_event: { date: string; title: string }; days_until: number };
    };
    expect(envelope.data.next_event.date).toBe('2026-04-03');
    expect(envelope.data.next_event.title).toBe('Good Friday');
    expect(envelope.data.days_until).toBe(2);
  });

  it('next_bank_holiday handles missing future events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(bankHolidaysFixture)));
    const { definitions } = makeDeps();

    const result = await definitions.nextBankHoliday.handler(
      { division: 'scotland', from_date: '2027-01-01' },
      {},
    );
    const envelope = result.structuredContent as { data: { next_event: null; days_until: null } };
    expect(envelope.data.next_event).toBeNull();
    expect(envelope.data.days_until).toBeNull();
  });

  it('validates bank holiday tool input schemas', () => {
    const { definitions } = makeDeps();
    expect(() =>
      z.object(definitions.bankHolidays.inputSchema).parse({ division: 'wales' }),
    ).toThrow();
    expect(() =>
      z
        .object(definitions.nextBankHoliday.inputSchema)
        .parse({ division: 'england-and-wales', from_date: 'not-a-date' }),
    ).toThrow();
  });
});
