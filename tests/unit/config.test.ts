import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    const config = loadConfig({});
    expect(config.MCP_TRANSPORT).toBe('stdio');
    expect(config.PORT).toBe(3000);
    expect(config.httpTimeoutMs).toBe(10000);
    expect(config.httpMaxRetries).toBe(3);
    expect(config.rateLimitRequests).toBe(60);
    expect(config.rateLimitWindowMs).toBe(60000);
    expect(config.cacheEnabled).toBe(true);
    expect(config.postcodesCacheTtlMs).toBe(86_400_000);
    expect(config.companiesHouseCacheTtlMs).toBe(900_000);
    expect(config.odsCacheTtlMs).toBe(86_400_000);
    expect(config.policeCacheTtlMs).toBe(300_000);
    expect(config.bankHolidaysCacheTtlMs).toBe(43_200_000);
    expect(config.companiesHouseRateLimitRequests).toBe(30);
    expect(config.policeRateLimitRequests).toBe(30);
    expect(config.upstreamConcurrency).toBe(4);
    expect(config.companiesHouseBaseUrl).toBe('https://api.company-information.service.gov.uk');
  });

  it('parses numeric and boolean environment values', () => {
    const config = loadConfig({
      PORT: '4000',
      HTTP_TIMEOUT_MS: '5000',
      CACHE_ENABLED: 'false',
      COMPANIES_HOUSE_API_KEY: 'test-key',
      RATE_LIMIT_REQUESTS: '10',
    });
    expect(config.PORT).toBe(4000);
    expect(config.httpTimeoutMs).toBe(5000);
    expect(config.cacheEnabled).toBe(false);
    expect(config.companiesHouseApiKey).toBe('test-key');
    expect(config.rateLimitRequests).toBe(10);
  });

  it('accepts an ODS base URL override', () => {
    const config = loadConfig({ ODS_BASE_URL: 'https://example.org/ods' });
    expect(config.odsBaseUrl).toBe('https://example.org/ods');
  });

  it('accepts a Companies House sandbox base URL override', () => {
    const config = loadConfig({
      COMPANIES_HOUSE_BASE_URL: 'https://api-sandbox.company-information.service.gov.uk',
    });
    expect(config.companiesHouseBaseUrl).toBe(
      'https://api-sandbox.company-information.service.gov.uk',
    );
  });

  it('rejects invalid ports and transports', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow();
    expect(() => loadConfig({ MCP_TRANSPORT: 'sse' })).toThrow();
    expect(() => loadConfig({ ODS_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('treats missing Companies House key as optional configuration', () => {
    const config = loadConfig({});
    expect(config.companiesHouseApiKey).toBeUndefined();
  });
});
