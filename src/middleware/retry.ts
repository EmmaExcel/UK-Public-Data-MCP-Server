export const MAX_BACKOFF_MS = 60_000;

export function shouldRetryStatus(statusCode: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(statusCode);
}

export function parseRetryAfterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, numeric);
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    const diffMs = parsed - Date.now();
    return Math.max(0, Math.ceil(diffMs / 1000));
  }

  return null;
}

export function getBackoffMs(attempt: number, retryAfterSeconds?: number | null): number {
  if (retryAfterSeconds !== undefined && retryAfterSeconds !== null && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
  }

  const baseDelay = 250 * 2 ** Math.max(0, attempt - 1);
  return Math.min(baseDelay + Math.floor(Math.random() * 200), MAX_BACKOFF_MS);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
