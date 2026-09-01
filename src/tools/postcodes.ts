import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizePostcode } from '../utils/normalize.js';
import { isValidLatitude, isValidLongitude } from '../utils/validation.js';
import type { PostcodesProvider } from '../providers/postcodes-provider.js';
import { runTool, type ToolExecutionContext, type ToolExtra } from './shared.js';

export interface PostcodesToolDeps {
  provider: PostcodesProvider;
  ctx: ToolExecutionContext;
}

export function createPostcodeToolDefinitions(deps: PostcodesToolDeps) {
  const { provider, ctx } = deps;

  const postcodeLookup = {
    name: 'postcode_lookup',
    description: 'Look up a UK postcode and return normalized address and location metadata.',
    inputSchema: {
      postcode: z.string().trim().min(2).max(12).transform(normalizePostcode),
    },
    handler: async ({ postcode }: { postcode: string }, extra: ToolExtra) => {
      return runTool({
        toolName: 'postcode_lookup',
        source: 'postcodes.io',
        args: { postcode },
        ttlMs: ctx.config.postcodesCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.lookup(postcode);
          return { data: result, source_url: result.source_url };
        },
      });
    },
  };

  const postcodeNearest = {
    name: 'postcode_nearest',
    description: 'Find nearby postcodes from a latitude and longitude.',
    inputSchema: {
      latitude: z.number().refine(isValidLatitude, 'Latitude must be between -90 and 90.'),
      longitude: z.number().refine(isValidLongitude, 'Longitude must be between -180 and 180.'),
      limit: z.number().int().min(1).max(100).default(10),
      radius_m: z.number().int().min(1).optional(),
    },
    handler: async (
      { latitude, longitude, limit, radius_m }: {
        latitude: number;
        longitude: number;
        limit?: number;
        radius_m?: number;
      },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'postcode_nearest',
        source: 'postcodes.io',
        args: { latitude, longitude, limit, radius_m },
        ttlMs: ctx.config.postcodesCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.nearest(latitude, longitude, limit ?? 10, radius_m);
          return { data: { results: result.results }, source_url: result.source_url };
        },
      });
    },
  };

  const postcodeSearch = {
    name: 'postcode_search',
    description: 'Search for postcodes by query text.',
    inputSchema: {
      query: z.string().trim().min(2).max(256),
      limit: z.number().int().min(1).max(100).default(10),
    },
    handler: async ({ query, limit }: { query: string; limit?: number }, extra: ToolExtra) => {
      return runTool({
        toolName: 'postcode_search',
        source: 'postcodes.io',
        args: { query, limit },
        ttlMs: ctx.config.postcodesCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.search(query, limit ?? 10);
          return { data: { results: result.results }, source_url: result.source_url };
        },
      });
    },
  };

  return { postcodeLookup, postcodeNearest, postcodeSearch };
}

export function registerPostcodesTools(server: McpServer, deps: PostcodesToolDeps) {
  const definitions = createPostcodeToolDefinitions(deps);
  server.registerTool(
    definitions.postcodeLookup.name,
    {
      description: definitions.postcodeLookup.description,
      inputSchema: definitions.postcodeLookup.inputSchema,
    },
    definitions.postcodeLookup.handler,
  );
  server.registerTool(
    definitions.postcodeNearest.name,
    {
      description: definitions.postcodeNearest.description,
      inputSchema: definitions.postcodeNearest.inputSchema,
    },
    definitions.postcodeNearest.handler,
  );
  server.registerTool(
    definitions.postcodeSearch.name,
    {
      description: definitions.postcodeSearch.description,
      inputSchema: definitions.postcodeSearch.inputSchema,
    },
    definitions.postcodeSearch.handler,
  );
}
