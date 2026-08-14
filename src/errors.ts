import type { ErrorCode } from './types.js';

export class AppError extends Error {
  code: ErrorCode;
  retryable: boolean;
  retryAfterSeconds: number | null;
  statusCode?: number;
  source?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: { retryable?: boolean; retryAfterSeconds?: number | null; statusCode?: number; source?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.statusCode = options.statusCode;
    this.source = options.source;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(Authorization:\s*).+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key=)([^&\s]+)/gi, '$1[REDACTED]')
    .replace(/(token=)([^&\s]+)/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+).+/gi, '$1[REDACTED]');
}

const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function mapHttpError(
  responseStatus: number,
  source: string,
  message?: string,
  retryAfterSeconds?: number | null,
): AppError {
  const sanitizedMessage = sanitizeErrorMessage(message ?? 'Upstream request failed');

  if (responseStatus === 401 || responseStatus === 403) {
    return new AppError('UPSTREAM_AUTH_FAILED', `Authentication failed for ${source}.`, {
      retryable: false,
      statusCode: responseStatus,
      source,
      retryAfterSeconds: retryAfterSeconds ?? null,
    });
  }

  if (responseStatus === 404) {
    return new AppError('NOT_FOUND', sanitizedMessage || `No result found from ${source}.`, {
      retryable: false,
      statusCode: responseStatus,
      source,
    });
  }

  if (responseStatus === 429) {
    return new AppError('UPSTREAM_RATE_LIMITED', `Rate limited by ${source}.`, {
      retryable: true,
      statusCode: responseStatus,
      source,
      retryAfterSeconds: retryAfterSeconds ?? null,
    });
  }

  if (responseStatus === 408 || responseStatus >= 500) {
    return new AppError('UPSTREAM_UNAVAILABLE', sanitizedMessage || `Upstream ${source} is unavailable.`, {
      retryable: RETRYABLE_UPSTREAM_STATUSES.has(responseStatus),
      statusCode: responseStatus,
      source,
      retryAfterSeconds: retryAfterSeconds ?? null,
    });
  }

  if (responseStatus >= 400) {
    return new AppError('INVALID_INPUT', sanitizedMessage || `Invalid request to ${source}.`, {
      retryable: false,
      statusCode: responseStatus,
      source,
    });
  }

  return new AppError('INTERNAL_ERROR', sanitizedMessage || `Unexpected failure while calling ${source}.`, {
    retryable: false,
    statusCode: responseStatus,
    source,
  });
}

export function invalidInput(message: string): AppError {
  return new AppError('INVALID_INPUT', message, { retryable: false });
}

export function configurationError(message: string): AppError {
  return new AppError('CONFIGURATION_ERROR', message, { retryable: false });
}
