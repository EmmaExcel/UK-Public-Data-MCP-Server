import { describe, expect, it } from 'vitest';
import { redactHeaders, redactUrl } from '../../src/utils/redact.js';

describe('redactHeaders', () => {
  it('redacts sensitive header values only', () => {
    const redacted = redactHeaders({
      authorization: 'Basic secret',
      'X-Api-Key': 'key-123',
      Accept: 'application/json',
      'x-request-id': 'abc',
    });
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted['X-Api-Key']).toBe('[REDACTED]');
    expect(redacted.Accept).toBe('application/json');
    expect(redacted['x-request-id']).toBe('abc');
  });
});

describe('redactUrl', () => {
  it('redacts sensitive query values but keeps harmless parameters', () => {
    const url = redactUrl('https://example.com/search?q=test&api_key=secret123&limit=10');
    expect(url).toContain('api_key=%5BREDACTED%5D');
    expect(url).toContain('q=test');
    expect(url).toContain('limit=10');
    expect(url).not.toContain('secret123');
  });

  it('handles URL objects', () => {
    const url = redactUrl(new URL('https://example.com/?token=abc'));
    expect(url).not.toContain('abc');
  });
});
