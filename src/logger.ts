import pino from 'pino';

export function createLogger(level: string = 'info') {
  return pino({
    name: 'uk-public-data-mcp',
    level,
    redact: {
      paths: ['authorization', 'Authorization', 'apiKey', 'apikey', 'token', 'secret', 'headers.authorization'],
      censor: '[REDACTED]',
    },
  });
}
