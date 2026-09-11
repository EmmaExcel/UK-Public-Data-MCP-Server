import { describe, expect, it } from 'vitest';
import { AppError, configurationError, invalidInput, mapHttpError, sanitizeErrorMessage } from '../../src/errors.js';

describe('sanitizeErrorMessage', () => {
  it('redacts authorization headers and tokens', () => {
    expect(sanitizeErrorMessage('Authorization: Basic abc123')).toBe('Authorization: [REDACTED]');
    expect(sanitizeErrorMessage('api_key=secret123')).toBe('api_key=[REDACTED]');
    expect(sanitizeErrorMessage('token=abcdef')).toBe('token=[REDACTED]');
    expect(sanitizeErrorMessage('Bearer xyz')).toBe('Bearer [REDACTED]');
  });

  it('leaves ordinary messages unchanged', () => {
    expect(sanitizeErrorMessage('No company found')).toBe('No company found');
  });
});

describe('mapHttpError', () => {
  it('maps 401 and 403 to UPSTREAM_AUTH_FAILED and never retries', () => {
    for (const status of [401, 403]) {
      const error = mapHttpError(status, 'companies-house');
      expect(error.code).toBe('UPSTREAM_AUTH_FAILED');
      expect(error.retryable).toBe(false);
    }
  });

  it('maps 404 to NOT_FOUND', () => {
    const error = mapHttpError(404, 'postcodes.io');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.retryable).toBe(false);
  });

  it('maps 429 to UPSTREAM_RATE_LIMITED with retry-after', () => {
    const error = mapHttpError(429, 'police.uk', 'Rate limited', 5);
    expect(error.code).toBe('UPSTREAM_RATE_LIMITED');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(5);
  });

  it('maps 408 to a retryable UPSTREAM_UNAVAILABLE', () => {
    const error = mapHttpError(408, 'companies-house');
    expect(error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(error.retryable).toBe(true);
  });

  it('marks only listed 5xx statuses retryable', () => {
    expect(mapHttpError(500, 'companies-house').retryable).toBe(true);
    expect(mapHttpError(502, 'companies-house').retryable).toBe(true);
    expect(mapHttpError(503, 'companies-house').retryable).toBe(true);
    expect(mapHttpError(504, 'companies-house').retryable).toBe(true);
    expect(mapHttpError(501, 'companies-house').retryable).toBe(false);
    expect(mapHttpError(505, 'companies-house').retryable).toBe(false);
  });

  it('maps other 4xx to INVALID_INPUT', () => {
    const error = mapHttpError(422, 'companies-house');
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.retryable).toBe(false);
  });

  it('sanitizes upstream messages', () => {
    const error = mapHttpError(400, 'companies-house', 'api_key=secret');
    expect(error.message).toBe('api_key=[REDACTED]');
  });
});

describe('AppError helpers', () => {
  it('creates AppError with the expected shape', () => {
    const error = new AppError('NOT_FOUND', 'Missing', { retryable: false, source: 'police.uk' });
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.source).toBe('police.uk');
    expect(error.retryAfterSeconds).toBeNull();
  });

  it('creates invalid input and configuration errors', () => {
    expect(invalidInput('bad').code).toBe('INVALID_INPUT');
    expect(configurationError('missing key').code).toBe('CONFIGURATION_ERROR');
  });
});
