import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizePostcode } from '../utils/normalize.js';
import type { OdsAdapter } from '../providers/ods-provider.js';
import { runTool, type ToolExecutionContext, type ToolExtra } from './shared.js';

export interface OdsToolDeps {
  provider: OdsAdapter;
  ctx: ToolExecutionContext;
}

export function createOdsToolDefinitions(deps: OdsToolDeps) {
  const { provider, ctx } = deps;

  const odsOrganisationLookup = {
    name: 'ods_organisation_lookup',
    description: 'Look up an NHS ODS organisation by ODS code.',
    inputSchema: {
      ods_code: z.string().trim().min(2).max(40),
    },
    handler: async ({ ods_code }: { ods_code: string }, extra: ToolExtra) => {
      return runTool({
        toolName: 'ods_organisation_lookup',
        source: 'nhs-ods',
        args: { ods_code },
        ttlMs: ctx.config.odsCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.lookup(ods_code);
          return { data: result, source_url: result.source_url };
        },
      });
    },
  };

  const odsOrganisationSearch = {
    name: 'ods_organisation_search',
    description: 'Search NHS ODS organisations by query and optional filters.',
    inputSchema: {
      query: z.string().trim().min(2).max(200),
      organisation_type: z.string().trim().optional(),
      active_only: z.boolean().default(true),
      limit: z.number().int().min(1).max(100).default(20),
    },
    handler: async (
      { query, organisation_type, active_only, limit }: {
        query: string;
        organisation_type?: string;
        active_only?: boolean;
        limit?: number;
      },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'ods_organisation_search',
        source: 'nhs-ods',
        args: { query, organisation_type, active_only, limit },
        ttlMs: ctx.config.odsCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.search(query, organisation_type, active_only ?? true, limit ?? 20);
          return { data: { results: result.results }, source_url: result.source_url };
        },
      });
    },
  };

  const odsOrganisationsByPostcode = {
    name: 'ods_organisations_by_postcode',
    description: 'Find NHS ODS organisations associated with a postcode.',
    inputSchema: {
      postcode: z.string().trim().min(3).max(12).transform(normalizePostcode),
      active_only: z.boolean().default(true),
    },
    handler: async (
      { postcode, active_only }: { postcode: string; active_only?: boolean },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'ods_organisations_by_postcode',
        source: 'nhs-ods',
        args: { postcode, active_only },
        ttlMs: ctx.config.odsCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.byPostcode(postcode, active_only ?? true);
          return { data: { results: result.results }, source_url: result.source_url };
        },
      });
    },
  };

  return { odsOrganisationLookup, odsOrganisationSearch, odsOrganisationsByPostcode };
}

export function registerOdsTools(server: McpServer, deps: OdsToolDeps) {
  const definitions = createOdsToolDefinitions(deps);
  server.registerTool(
    definitions.odsOrganisationLookup.name,
    {
      description: definitions.odsOrganisationLookup.description,
      inputSchema: definitions.odsOrganisationLookup.inputSchema,
    },
    definitions.odsOrganisationLookup.handler,
  );
  server.registerTool(
    definitions.odsOrganisationSearch.name,
    {
      description: definitions.odsOrganisationSearch.description,
      inputSchema: definitions.odsOrganisationSearch.inputSchema,
    },
    definitions.odsOrganisationSearch.handler,
  );
  server.registerTool(
    definitions.odsOrganisationsByPostcode.name,
    {
      description: definitions.odsOrganisationsByPostcode.description,
      inputSchema: definitions.odsOrganisationsByPostcode.inputSchema,
    },
    definitions.odsOrganisationsByPostcode.handler,
  );
}
