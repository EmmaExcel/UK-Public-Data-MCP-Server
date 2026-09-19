import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../../src/config.js';
import {
  createHttpServer,
  createServer,
  createSharedDeps,
  startServer,
} from '../../src/server.js';

const { stdioStartMock } = vi.hoisted(() => ({
  stdioStartMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    start = stdioStartMock;
  },
}));

function httpConfig() {
  return loadConfig({
    MCP_TRANSPORT: 'http',
    LOG_LEVEL: 'fatal',
    COMPANIES_HOUSE_API_KEY: 'test-key',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('server assembly', () => {
  it('creates a server with providers and shared dependencies', () => {
    const config = loadConfig({ LOG_LEVEL: 'fatal', COMPANIES_HOUSE_API_KEY: 'test-key' });
    const shared = createSharedDeps(config);
    const app = createServer(config, shared);

    expect(app.server).toBeTruthy();
    expect(app.providers.postcodes).toBeTruthy();
    expect(app.providers.companiesHouse).toBeTruthy();
    expect(app.providers.ods).toBeTruthy();
    expect(app.providers.police).toBeTruthy();
    expect(app.providers.bankHolidays).toBeTruthy();
    expect(app.cache).toBe(shared.cache);
    expect(app.rateLimiter).toBe(shared.rateLimiter);
  });

  it('exposes a health endpoint in HTTP transport mode', async () => {
    const shared = createSharedDeps(httpConfig());
    const server = createHttpServer(shared);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', transport: 'http' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns 404 for unknown HTTP routes', async () => {
    const shared = createSharedDeps(httpConfig());
    const server = createHttpServer(shared);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/missing`);
      expect(response.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects malformed MCP JSON bodies with a JSON-RPC error', async () => {
    const shared = createSharedDeps(httpConfig());
    const server = createHttpServer(shared);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      });
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: { code: number } };
      expect(body.error.code).toBe(-32603);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('startServer', () => {
  it('sets a non-zero exit code for invalid configuration', async () => {
    vi.stubEnv('MCP_TRANSPORT', 'invalid-transport');
    process.exitCode = 0;
    await startServer();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('connects to stdio transport when configured', async () => {
    vi.stubEnv('MCP_TRANSPORT', 'stdio');
    vi.stubEnv('LOG_LEVEL', 'fatal');
    await startServer();
    expect(stdioStartMock).toHaveBeenCalled();
  });
});
