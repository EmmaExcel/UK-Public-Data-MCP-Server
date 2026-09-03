import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { daysUntil } from '../utils/date.js';
import type { BankHolidaysProvider, BankHolidayDivision } from '../providers/bank-holidays-provider.js';
import { runTool, type ToolExecutionContext, type ToolExtra } from './shared.js';

export interface BankHolidaysToolDeps {
  provider: BankHolidaysProvider;
  ctx: ToolExecutionContext;
}

const divisionSchema = z.enum(['england-and-wales', 'scotland', 'northern-ireland']);

export function createBankHolidaysToolDefinitions(deps: BankHolidaysToolDeps) {
  const { provider, ctx } = deps;

  const bankHolidays = {
    name: 'bank_holidays',
    description: 'Get UK bank holidays for a division and optional year.',
    inputSchema: {
      division: divisionSchema,
      year: z.number().int().min(1900).max(2100).optional(),
    },
    handler: async (
      { division, year }: { division: BankHolidayDivision; year?: number },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'bank_holidays',
        source: 'govuk-bank-holidays',
        args: { division, year },
        ttlMs: ctx.config.bankHolidaysCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.getDivision(division, year);
          return { data: result, source_url: result.source_url };
        },
      });
    },
  };

  const nextBankHoliday = {
    name: 'next_bank_holiday',
    description: 'Return the next bank holiday on or after a date for a division.',
    inputSchema: {
      division: divisionSchema,
      from_date: z.string().date().optional(),
    },
    handler: async (
      { division, from_date }: { division: BankHolidayDivision; from_date?: string },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'next_bank_holiday',
        source: 'govuk-bank-holidays',
        args: { division, from_date },
        ttlMs: ctx.config.bankHolidaysCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        cacheable: false,
        handler: async () => {
          const result = await provider.getDivision(division);
          const events = Array.isArray((result as { events?: Array<Record<string, unknown>> }).events)
            ? ((result as { events?: Array<Record<string, unknown>> }).events ?? [])
            : [];
          const startDate = from_date ? new Date(`${from_date}T00:00:00Z`) : new Date();
          const nextEvent = events.find((event) => {
            const date = typeof event.date === 'string' ? event.date : '';
            return Boolean(date) && new Date(`${date}T00:00:00Z`) >= startDate;
          });

          const payload = nextEvent
            ? {
                division,
                next_event: nextEvent,
                days_until: daysUntil(String(nextEvent.date), startDate),
              }
            : {
                division,
                next_event: null,
                days_until: null,
              };

          return { data: payload, source_url: result.source_url };
        },
      });
    },
  };

  return { bankHolidays, nextBankHoliday };
}

export function registerBankHolidaysTools(server: McpServer, deps: BankHolidaysToolDeps) {
  const definitions = createBankHolidaysToolDefinitions(deps);
  server.registerTool(
    definitions.bankHolidays.name,
    { description: definitions.bankHolidays.description, inputSchema: definitions.bankHolidays.inputSchema },
    definitions.bankHolidays.handler,
  );
  server.registerTool(
    definitions.nextBankHoliday.name,
    {
      description: definitions.nextBankHoliday.description,
      inputSchema: definitions.nextBankHoliday.inputSchema,
    },
    definitions.nextBankHoliday.handler,
  );
}
