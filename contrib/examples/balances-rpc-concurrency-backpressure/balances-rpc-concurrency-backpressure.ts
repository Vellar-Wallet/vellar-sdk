/**
 * Issue #243: Concurrency Limit and Backpressure Queue for Balance RPC Requests.
 */

export class ConcurrentBalanceQueue {
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(public readonly maxConcurrency: number = 4) {
    if (maxConcurrency < 1) throw new Error("maxConcurrency must be at least 1");
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next?.();
      }
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.activeCount;
  }
}
