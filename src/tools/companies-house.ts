import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CompaniesHouseProvider } from '../providers/companies-house-provider.js';
import { runTool, type ToolExecutionContext, type ToolExtra } from './shared.js';

export interface CompaniesHouseToolDeps {
  provider: CompaniesHouseProvider;
  ctx: ToolExecutionContext;
}

export function createCompaniesHouseToolDefinitions(deps: CompaniesHouseToolDeps) {
  const { provider, ctx } = deps;

  const companySearch = {
    name: 'company_search',
    description: 'Search Companies House for companies matching a query.',
    inputSchema: {
      query: z.string().trim().min(2).max(200),
      items_per_page: z.number().int().min(1).max(100).default(20),
      start_index: z.number().int().min(0).default(0),
    },
    handler: async (
      { query, items_per_page, start_index }: {
        query: string;
        items_per_page?: number;
        start_index?: number;
      },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'company_search',
        source: 'companies-house',
        args: { query, items_per_page, start_index },
        ttlMs: ctx.config.companiesHouseCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.search(query, items_per_page ?? 20, start_index ?? 0);
          return {
            data: {
              items: result.items,
              total_results: result.total_results,
              items_per_page: result.items_per_page,
              start_index: result.start_index,
            },
            source_url: result.source_url,
          };
        },
      });
    },
  };

  const companyProfile = {
    name: 'company_profile',
    description: 'Fetch a company profile by company number.',
    inputSchema: {
      company_number: z.string().trim().min(2).max(20),
    },
    handler: async ({ company_number }: { company_number: string }, extra: ToolExtra) => {
      return runTool({
        toolName: 'company_profile',
        source: 'companies-house',
        args: { company_number },
        ttlMs: ctx.config.companiesHouseCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.getProfile(company_number);
          return { data: result, source_url: result.source_url };
        },
      });
    },
  };

  const companyOfficers = {
    name: 'company_officers',
    description: 'List officers for a company.',
    inputSchema: {
      company_number: z.string().trim().min(2).max(20),
      items_per_page: z.number().int().min(1).max(100).default(20),
      start_index: z.number().int().min(0).default(0),
    },
    handler: async (
      { company_number, items_per_page, start_index }: {
        company_number: string;
        items_per_page?: number;
        start_index?: number;
      },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'company_officers',
        source: 'companies-house',
        args: { company_number, items_per_page, start_index },
        ttlMs: ctx.config.companiesHouseCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.getOfficers(
            company_number,
            items_per_page ?? 20,
            start_index ?? 0,
          );
          return {
            data: {
              items: result.items,
              items_per_page: result.items_per_page,
              start_index: result.start_index,
              total_results: result.total_results,
            },
            source_url: result.source_url,
          };
        },
      });
    },
  };

  const companyFilingHistory = {
    name: 'company_filing_history',
    description: 'List filing history for a company.',
    inputSchema: {
      company_number: z.string().trim().min(2).max(20),
      items_per_page: z.number().int().min(1).max(100).default(20),
      start_index: z.number().int().min(0).default(0),
    },
    handler: async (
      { company_number, items_per_page, start_index }: {
        company_number: string;
        items_per_page?: number;
        start_index?: number;
      },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'company_filing_history',
        source: 'companies-house',
        args: { company_number, items_per_page, start_index },
        ttlMs: ctx.config.companiesHouseCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.getFilingHistory(
            company_number,
            items_per_page ?? 20,
            start_index ?? 0,
          );
          return {
            data: {
              items: result.items,
              items_per_page: result.items_per_page,
              start_index: result.start_index,
              total_results: result.total_results,
            },
            source_url: result.source_url,
          };
        },
      });
    },
  };

  return { companySearch, companyProfile, companyOfficers, companyFilingHistory };
}

export function registerCompaniesHouseTools(server: McpServer, deps: CompaniesHouseToolDeps) {
  const definitions = createCompaniesHouseToolDefinitions(deps);
  server.registerTool(
    definitions.companySearch.name,
    { description: definitions.companySearch.description, inputSchema: definitions.companySearch.inputSchema },
    definitions.companySearch.handler,
  );
  server.registerTool(
    definitions.companyProfile.name,
    { description: definitions.companyProfile.description, inputSchema: definitions.companyProfile.inputSchema },
    definitions.companyProfile.handler,
  );
  server.registerTool(
    definitions.companyOfficers.name,
    { description: definitions.companyOfficers.description, inputSchema: definitions.companyOfficers.inputSchema },
    definitions.companyOfficers.handler,
  );
  server.registerTool(
    definitions.companyFilingHistory.name,
    {
      description: definitions.companyFilingHistory.description,
      inputSchema: definitions.companyFilingHistory.inputSchema,
    },
    definitions.companyFilingHistory.handler,
  );
}
