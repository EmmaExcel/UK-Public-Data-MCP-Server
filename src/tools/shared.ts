import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppError, sanitizeErrorMessage } from '../errors.js';
import type { TtlCache } from '../middleware/cache.js';
import type { SlidingWindowRateLimiter } from '../middleware/rate-limiter.js';
import type {
  SuccessMeta,
  ToolErrorEnvelope,
  ToolRuntimeConfig,
  ToolSuccessEnvelope,
} from '../types.js';

export type ToolExtra = { sessionId?: string };

export interface ToolExecutionContext {
  cache: TtlCache;
  rateLimiter: SlidingWindowRateLimiter;
  config: ToolRuntimeConfig;
}

export interface ToolHandlerResult {
  data: unknown;
  source_url: string;
}

export interface RunToolOptions {
  toolName: string;
  source: string;
  args: Record<string, unknown>;
  ttlMs: number;
  ctx: ToolExecutionContext;
  sessionId?: string;
  cacheable?: boolean;
  handler: () => Promise<ToolHandlerResult>;
}

interface CachedToolResult {
  data: unknown;
  source_url: string;
  retrieved_at: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function buildCacheKey(toolName: string, args: Record<string, unknown>): string {
  return `tool:${toolName}:${stableStringify(args)}`;
}

export function successEnvelope<T>(
  data: T,
  source: string,
  sourceUrl: string,
  cached: boolean,
  retrievedAt = new Date().toISOString(),
): ToolSuccessEnvelope<T> {
  const meta: SuccessMeta = {
    source,
    source_url: sourceUrl,
    retrieved_at: retrievedAt,
    cached,
    request_id: randomUUID(),
  };
  return { data, meta };
}

export function errorEnvelope(error: unknown, source?: string): ToolErrorEnvelope {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: sanitizeErrorMessage(error.message),
        retryable: error.retryable,
        retry_after_seconds: error.retryAfterSeconds,
      },
      meta: {
        source: error.source ?? source,
        request_id: randomUUID(),
      },
    };
  }

  const message =
    error instanceof Error ? sanitizeErrorMessage(error.message) : 'Unexpected internal error.';
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message,
      retryable: false,
      retry_after_seconds: null,
    },
    meta: {
      source,
      request_id: randomUUID(),
    },
  };
}

function rateLimitErrorEnvelope(source: string, retryAfterMs: number): ToolErrorEnvelope {
  return {
    error: {
      code: 'UPSTREAM_RATE_LIMITED',
      message: 'Rate limit exceeded. Please retry after the indicated delay.',
      retryable: true,
      retry_after_seconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    },
    meta: {
      source,
      request_id: randomUUID(),
    },
  };
}

export function toolResult(
  envelope: ToolSuccessEnvelope<unknown> | ToolErrorEnvelope,
): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}

export async function runTool(options: RunToolOptions): Promise<CallToolResult> {
  const { ctx, toolName, source, args, sessionId } = options;

  const rateLimitKey = `client:${sessionId ?? 'process'}`;
  const decision = ctx.rateLimiter.check(rateLimitKey);
  if (!decision.allowed) {
    return toolResult(rateLimitErrorEnvelope(source, decision.retryAfterMs));
  }

  const cacheKey = buildCacheKey(toolName, args);
  if (ctx.config.cacheEnabled && options.ttlMs > 0) {
    const cached = ctx.cache.get<CachedToolResult>(cacheKey);
    if (cached) {
      return toolResult(
        successEnvelope(cached.data, source, cached.source_url, true, cached.retrieved_at),
      );
    }
  }

  try {
    const { data, source_url } = await options.handler();
    const retrievedAt = new Date().toISOString();
    if (options.cacheable !== false && ctx.config.cacheEnabled && options.ttlMs > 0) {
      ctx.cache.set(cacheKey, { data, source_url, retrieved_at: retrievedAt }, options.ttlMs);
    }
    return toolResult(successEnvelope(data, source, source_url, false, retrievedAt));
  } catch (error) {
    return toolResult(errorEnvelope(error, source));
  }
}
