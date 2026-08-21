import type { Logger } from 'pino';
import pino from 'pino';
import { AppError, mapHttpError } from '../errors.js';
import { getBackoffMs, parseRetryAfterSeconds, shouldRetryStatus, sleep } from '../middleware/retry.js';
import { ConcurrencyLimiter } from '../middleware/concurrency-limiter.js';
import { RateLimiterRegistry, type RateLimitSpec } from '../middleware/rate-limiter.js';
import { redactHeaders, redactUrl } from '../utils/redact.js';
import type { HttpRequestOptions } from '../types.js';

const CIRCUIT_BREAKER_COOLDOWN_MS = 20_000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const NON_RETRYABLE_CODES = new Set(['INVALID_INPUT', 'NOT_FOUND', 'CONFIGURATION_ERROR', 'UPSTREAM_AUTH_FAILED']);

interface CircuitState {
  failures: number;
  openedAt: number;
  status: 'closed' | 'open';
}

export interface HttpClientOptions {
  timeoutMs: number;
  maxRetries: number;
  logger?: Logger;
  concurrencyPerUpstream?: number;
  sourceRateLimits?: Record<string, RateLimitSpec>;
}

export class HttpClient {
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly concurrencyLimiter: ConcurrencyLimiter;
  private readonly sourceRateLimiter?: RateLimiterRegistry;
  private readonly circuitBreakers = new Map<string, CircuitState>();

  constructor(options: HttpClientOptions) {
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.logger = options.logger ?? pinoStub();
    this.concurrencyLimiter = new ConcurrencyLimiter(options.concurrencyPerUpstream ?? 4);
    if (options.sourceRateLimits && Object.keys(options.sourceRateLimits).length > 0) {
      this.sourceRateLimiter = new RateLimiterRegistry(options.sourceRateLimits);
    }
  }

  async request<T>(options: HttpRequestOptions): Promise<T> {
    const source = options.source ?? 'unknown';
    const method = options.method ?? 'GET';
    const requestUrl = new URL(options.url);

    if (requestUrl.protocol !== 'https:') {
      throw new AppError('CONFIGURATION_ERROR', `HTTPS is required for ${source}.`, {
        retryable: false,
        source,
      });
    }

    return this.concurrencyLimiter.run(source, () =>
      this.performRequest<T>(requestUrl, method, source, options),
    );
  }

  private async performRequest<T>(
    requestUrl: URL,
    method: string,
    source: string,
    options: HttpRequestOptions,
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const breakerKey = `${requestUrl.origin}${requestUrl.pathname}`;
    const breaker = this.getBreaker(breakerKey);

    if (breaker.status === 'open' && Date.now() - breaker.openedAt < CIRCUIT_BREAKER_COOLDOWN_MS) {
      throw new AppError('UPSTREAM_UNAVAILABLE', `Circuit breaker open for ${source}.`, {
        retryable: true,
        source,
      });
    }

    if (breaker.status === 'open') {
      breaker.status = 'closed';
      breaker.failures = 0;
    }

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const throttle = this.sourceRateLimiter?.check(source);
        if (throttle && !throttle.allowed) {
          const retryAfterSeconds = Math.max(1, Math.ceil(throttle.retryAfterMs / 1000));
          throw new AppError('UPSTREAM_RATE_LIMITED', `Source throttle engaged for ${source}.`, {
            retryable: true,
            retryAfterSeconds,
            source,
          });
        }

        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

        try {
          const headers = options.headers ?? {};
          this.logger.debug(
            {
              source,
              method,
              url: redactUrl(requestUrl),
              headers: redactHeaders(headers),
              attempt,
            },
            'Sending HTTP request',
          );

          const rawBody = options.body === undefined ? undefined : JSON.stringify(options.body);
          const response = await fetch(requestUrl.toString(), {
            method,
            headers,
            body: rawBody,
            signal: controller.signal,
          });

          if (response.status >= 400) {
            const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
            const retryable =
              shouldRetryStatus(response.status) &&
              method === 'GET' &&
              options.allowRetry !== false &&
              attempt < maxRetries;

            if (retryable) {
              const delayMs = getBackoffMs(attempt + 1, retryAfterSeconds);
              this.logger.warn(
                { source, status: response.status, delayMs, attempt },
                'Retrying transient upstream failure',
              );
              await sleep(delayMs);
              continue;
            }

            throw mapHttpError(
              response.status,
              source,
              `Request failed with ${response.status}`,
              retryAfterSeconds,
            );
          }

          const contentType = response.headers.get('content-type') ?? '';
          const payload = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

          breaker.failures = 0;
          breaker.status = 'closed';
          return payload as T;
        } finally {
          clearTimeout(timeoutHandle);
        }
      } catch (error) {
        if (error instanceof AppError) {
          if (NON_RETRYABLE_CODES.has(error.code)) {
            throw error;
          }

          if (
            error.retryable &&
            method === 'GET' &&
            options.allowRetry !== false &&
            attempt < maxRetries
          ) {
            const delayMs = getBackoffMs(attempt + 1, error.retryAfterSeconds);
            this.logger.warn({ source, attempt, delayMs }, 'Retrying transient upstream failure');
            await sleep(delayMs);
            continue;
          }

          if (error.code === 'UPSTREAM_UNAVAILABLE') {
            this.recordFailure(breaker);
          }
          throw error;
        }

        const retryable = method === 'GET' && options.allowRetry !== false && attempt < maxRetries;
        if (retryable) {
          const delayMs = getBackoffMs(attempt + 1);
          this.logger.warn({ source, attempt, delayMs }, 'Retrying network or timeout failure');
          await sleep(delayMs);
          continue;
        }

        this.recordFailure(breaker);
        throw new AppError('UPSTREAM_UNAVAILABLE', `Request to ${source} failed.`, {
          retryable: false,
          source,
          cause: error,
        });
      }
    }

    throw new AppError('UPSTREAM_UNAVAILABLE', `Upstream ${source} is unavailable.`, {
      retryable: true,
      source,
    });
  }

  private getBreaker(key: string): CircuitState {
    let breaker = this.circuitBreakers.get(key);
    if (!breaker) {
      breaker = { failures: 0, openedAt: 0, status: 'closed' };
      this.circuitBreakers.set(key, breaker);
    }
    return breaker;
  }

  private recordFailure(breaker: CircuitState): void {
    breaker.failures += 1;
    if (breaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      breaker.status = 'open';
      breaker.openedAt = Date.now();
    }
  }
}

function pinoStub(): Logger {
  return pino({ enabled: false });
}
