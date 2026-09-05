import { createServer as createNodeHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig, type AppConfig } from './config.js';
import { createLogger } from './logger.js';
import { AppError } from './errors.js';
import { HttpClient } from './clients/http-client.js';
import { TtlCache } from './middleware/cache.js';
import { SlidingWindowRateLimiter } from './middleware/rate-limiter.js';
import { BankHolidaysProvider } from './providers/bank-holidays-provider.js';
import { CompaniesHouseProvider } from './providers/companies-house-provider.js';
import { OdsProvider } from './providers/ods-provider.js';
import { PoliceProvider } from './providers/police-provider.js';
import { PostcodesProvider } from './providers/postcodes-provider.js';
import { registerBankHolidaysTools } from './tools/bank-holidays.js';
import { registerCompaniesHouseTools } from './tools/companies-house.js';
import { registerOdsTools } from './tools/ods.js';
import { registerPoliceTools } from './tools/police.js';
import { registerPostcodesTools } from './tools/postcodes.js';
import type { ToolExecutionContext } from './tools/shared.js';

export interface SharedDeps {
  config: AppConfig;
  logger: Logger;
  httpClient: HttpClient;
  cache: TtlCache;
  rateLimiter: SlidingWindowRateLimiter;
}

export function createSharedDeps(config: AppConfig): SharedDeps {
  const logger = createLogger(config.LOG_LEVEL);
  const httpClient = new HttpClient({
    timeoutMs: config.httpTimeoutMs,
    maxRetries: config.httpMaxRetries,
    logger,
    concurrencyPerUpstream: config.upstreamConcurrency,
    sourceRateLimits: {
      'companies-house': {
        limit: config.companiesHouseRateLimitRequests,
        windowMs: config.rateLimitWindowMs,
      },
      'police.uk': {
        limit: config.policeRateLimitRequests,
        windowMs: config.rateLimitWindowMs,
      },
    },
  });
  const cache = new TtlCache();
  const rateLimiter = new SlidingWindowRateLimiter(config.rateLimitRequests, config.rateLimitWindowMs);

  return { config, logger, httpClient, cache, rateLimiter };
}

export function createToolContext(
  config: AppConfig,
  cache: TtlCache,
  rateLimiter: SlidingWindowRateLimiter,
): ToolExecutionContext {
  return {
    cache,
    rateLimiter,
    config: {
      cacheEnabled: config.cacheEnabled,
      rateLimitRequests: config.rateLimitRequests,
      rateLimitWindowMs: config.rateLimitWindowMs,
      postcodesCacheTtlMs: config.postcodesCacheTtlMs,
      companiesHouseCacheTtlMs: config.companiesHouseCacheTtlMs,
      odsCacheTtlMs: config.odsCacheTtlMs,
      policeCacheTtlMs: config.policeCacheTtlMs,
      bankHolidaysCacheTtlMs: config.bankHolidaysCacheTtlMs,
    },
  };
}

export function createMcpServer(shared: SharedDeps) {
  const { config, logger, httpClient, cache, rateLimiter } = shared;
  const ctx = createToolContext(config, cache, rateLimiter);

  const postcodesProvider = new PostcodesProvider(httpClient);
  const companiesHouseProvider = new CompaniesHouseProvider(httpClient, config);
  const odsProvider = new OdsProvider(httpClient, config.odsBaseUrl);
  const policeProvider = new PoliceProvider(httpClient, postcodesProvider);
  const bankHolidaysProvider = new BankHolidaysProvider(httpClient);

  const server = new McpServer(
    {
      name: 'uk-public-data-mcp',
      version: '1.0.0',
    },
    {
      capabilities: { logging: {} },
    },
  );

  registerPostcodesTools(server, { provider: postcodesProvider, ctx });
  registerCompaniesHouseTools(server, { provider: companiesHouseProvider, ctx });
  registerOdsTools(server, { provider: odsProvider, ctx });
  registerPoliceTools(server, { provider: policeProvider, ctx });
  registerBankHolidaysTools(server, { provider: bankHolidaysProvider, ctx });

  return {
    server,
    logger,
    providers: {
      postcodes: postcodesProvider,
      companiesHouse: companiesHouseProvider,
      ods: odsProvider,
      police: policeProvider,
      bankHolidays: bankHolidaysProvider,
    },
  };
}

export function createServer(config: AppConfig = loadConfig(), shared: SharedDeps = createSharedDeps(config)) {
  const { server, logger, providers } = createMcpServer(shared);
  return {
    server,
    config,
    logger,
    cache: shared.cache,
    rateLimiter: shared.rateLimiter,
    httpClient: shared.httpClient,
    providers,
  };
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new AppError('INVALID_INPUT', 'Request body too large.', { retryable: false }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new AppError('INVALID_INPUT', 'Invalid JSON body.', { retryable: false, cause: error }));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  if (res.headersSent) return;
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export function createHttpServer(shared: SharedDeps) {
  return createNodeHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', transport: 'http' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/mcp') {
      try {
        const body = await readJsonBody(req, 1_000_000);
        const { server } = createMcpServer(shared);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
      } catch (error) {
        shared.logger.error({ err: error }, 'Error handling MCP HTTP request');
        sendJson(res, 500, {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  });
}

export async function startServer(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(
      'Invalid server configuration:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
    return;
  }

  const shared = createSharedDeps(config);
  shared.logger.info({ transport: config.MCP_TRANSPORT }, 'Starting UK public data MCP server');

  if (!config.companiesHouseApiKey) {
    shared.logger.warn(
      'COMPANIES_HOUSE_API_KEY is not set; Companies House tools will return a CONFIGURATION_ERROR when called.',
    );
  }

  if (config.MCP_TRANSPORT === 'http') {
    const httpServer = createHttpServer(shared);
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.PORT, () => resolve());
    });
    shared.logger.info({ port: config.PORT }, 'Streamable HTTP MCP server listening');

    await new Promise<void>((resolve) => {
      const shutdown = () => {
        httpServer.close(() => resolve());
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
    return;
  }

  const { server } = createMcpServer(shared);
  await server.connect(new StdioServerTransport());
}
