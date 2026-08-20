export class ConcurrencyLimiter {
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();

  constructor(private readonly limit: number) {}

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const current = this.active.get(key) ?? 0;
    if (current >= this.limit) {
      await new Promise<void>((resolve) => {
        const queue = this.waiters.get(key) ?? [];
        queue.push(resolve);
        this.waiters.set(key, queue);
      });
    }

    this.active.set(key, (this.active.get(key) ?? 0) + 1);
    try {
      return await task();
    } finally {
      const remaining = (this.active.get(key) ?? 0) - 1;
      if (remaining <= 0) {
        this.active.delete(key);
      } else {
        this.active.set(key, remaining);
      }
      const next = this.waiters.get(key)?.shift();
      if (next) {
        if (!this.waiters.get(key)?.length) {
          this.waiters.delete(key);
        }
        next();
      }
    }
  }
}
