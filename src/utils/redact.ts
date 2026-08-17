const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'x-api-key', 'apikey', 'api-key', 'token']);

const SENSITIVE_QUERY_KEYS = new Set(['api_key', 'apikey', 'api-key', 'key', 'token', 'auth', 'authorization', 'sig', 'signature', 'secret']);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return redacted;
}

export function redactUrl(input: string | URL): string {
  const url = typeof input === 'string' ? new URL(input) : new URL(input.toString());
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      url.searchParams.set(key, '[REDACTED]');
    }
  }
  return url.toString();
}
