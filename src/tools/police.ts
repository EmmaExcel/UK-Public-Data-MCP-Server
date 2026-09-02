import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isFutureMonth, isValidLatitude, isValidLongitude } from '../utils/validation.js';
import { normalizePostcode } from '../utils/normalize.js';
import type { PoliceProvider } from '../providers/police-provider.js';
import { runTool, type ToolExecutionContext, type ToolExtra } from './shared.js';

export interface PoliceToolDeps {
  provider: PoliceProvider;
  ctx: ToolExecutionContext;
}

const PRIVACY_NOTE =
  'Police.uk crime locations are approximate and may be anonymised by the upstream service. Historical coverage is subject to source-specific availability limits.';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .optional()
  .refine((value) => !isFutureMonth(value), 'Date must not be in the future.');

export function createPoliceToolDefinitions(deps: PoliceToolDeps) {
  const { provider, ctx } = deps;

  const policeForces = {
    name: 'police_forces',
    description: 'List police forces available from the police.uk API.',
    inputSchema: {},
    handler: async (_args: Record<string, never>, extra: ToolExtra) => {
      return runTool({
        toolName: 'police_forces',
        source: 'police.uk',
        args: {},
        ttlMs: ctx.config.policeCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.getForces();
          return { data: { forces: result.forces }, source_url: result.source_url };
        },
      });
    },
  };

  const policeNeighbourhoods = {
    name: 'police_neighbourhoods',
    description: 'List neighbourhoods for a police force.',
    inputSchema: {
      force_id: z.string().trim().min(1),
    },
    handler: async ({ force_id }: { force_id: string }, extra: ToolExtra) => {
      return runTool({
        toolName: 'police_neighbourhoods',
        source: 'police.uk',
        args: { force_id },
        ttlMs: ctx.config.policeCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.getNeighbourhoods(force_id);
          return { data: { neighbourhoods: result.neighbourhoods }, source_url: result.source_url };
        },
      });
    },
  };

  const policeCrimesAtLocation = {
    name: 'police_crimes_at_location',
    description:
      'List crime incidents near a latitude and longitude. Historical coverage is subject to source-specific availability limits and coordinates may be anonymised upstream.',
    inputSchema: {
      latitude: z.number().refine(isValidLatitude, 'Latitude must be between -90 and 90.'),
      longitude: z.number().refine(isValidLongitude, 'Longitude must be between -180 and 180.'),
      date: dateSchema,
    },
    handler: async (
      { latitude, longitude, date }: { latitude: number; longitude: number; date?: string },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'police_crimes_at_location',
        source: 'police.uk',
        args: { latitude, longitude, date },
        ttlMs: ctx.config.policeCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        handler: async () => {
          const result = await provider.getCrimesAtLocation(latitude, longitude, date);
          return {
            data: { crimes: result.crimes, privacy_note: PRIVACY_NOTE },
            source_url: result.source_url,
          };
        },
      });
    },
  };

  const policeCrimesByPostcode = {
    name: 'police_crimes_by_postcode',
    description:
      'Resolve a postcode with postcodes.io and query police.uk crimes nearby, returning a clear partial-result response if the police lookup fails.',
    inputSchema: {
      postcode: z.string().trim().min(3).max(12).transform(normalizePostcode),
      date: dateSchema,
    },
    handler: async (
      { postcode, date }: { postcode: string; date?: string },
      extra: ToolExtra,
    ) => {
      return runTool({
        toolName: 'police_crimes_by_postcode',
        source: 'police.uk',
        args: { postcode, date },
        ttlMs: ctx.config.policeCacheTtlMs,
        ctx,
        sessionId: extra.sessionId,
        cacheable: false,
        handler: async () => {
          const result = await provider.getCrimesByPostcodeWithPartial(postcode, date);
          return {
            data: {
              partial: result.partial,
              resolved_postcode: result.resolved_postcode,
              latitude: result.latitude,
              longitude: result.longitude,
              crimes: result.crimes,
              error: result.error,
              privacy_note: PRIVACY_NOTE,
            },
            source_url: result.source_url,
          };
        },
      });
    },
  };

  return { policeForces, policeNeighbourhoods, policeCrimesAtLocation, policeCrimesByPostcode };
}

export function registerPoliceTools(server: McpServer, deps: PoliceToolDeps) {
  const definitions = createPoliceToolDefinitions(deps);
  server.registerTool(
    definitions.policeForces.name,
    { description: definitions.policeForces.description, inputSchema: definitions.policeForces.inputSchema },
    definitions.policeForces.handler,
  );
  server.registerTool(
    definitions.policeNeighbourhoods.name,
    {
      description: definitions.policeNeighbourhoods.description,
      inputSchema: definitions.policeNeighbourhoods.inputSchema,
    },
    definitions.policeNeighbourhoods.handler,
  );
  server.registerTool(
    definitions.policeCrimesAtLocation.name,
    {
      description: definitions.policeCrimesAtLocation.description,
      inputSchema: definitions.policeCrimesAtLocation.inputSchema,
    },
    definitions.policeCrimesAtLocation.handler,
  );
  server.registerTool(
    definitions.policeCrimesByPostcode.name,
    {
      description: definitions.policeCrimesByPostcode.description,
      inputSchema: definitions.policeCrimesByPostcode.inputSchema,
    },
    definitions.policeCrimesByPostcode.handler,
  );
}
