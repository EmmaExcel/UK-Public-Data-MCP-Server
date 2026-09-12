import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter } from '../../src/middleware/concurrency-limiter.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('ConcurrencyLimiter', () => {
  it('allows tasks under the limit and queues the rest', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const first = deferred();
    const second = deferred();
    const third = deferred();

    let active = 0;
    let peak = 0;

    const task = (gate: Promise<void>) =>
      limiter.run('upstream', async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate;
        active -= 1;
        return true;
      });

    const p1 = task(first.promise);
    const p2 = task(second.promise);
    const p3 = task(third.promise);

    await Promise.resolve();
    expect(active).toBe(2);

    first.resolve();
    await p1;
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2);

    second.resolve();
    await p2;
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(1);

    third.resolve();
    await p3;
    expect(peak).toBe(2);
  });

  it('releases the slot when a task throws', async () => {
    const limiter = new ConcurrencyLimiter(1);
    await expect(
      limiter.run('upstream', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const result = await limiter.run('upstream', async () => 'ok');
    expect(result).toBe('ok');
  });
});
