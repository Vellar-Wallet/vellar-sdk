/**
 * A queue that runs `fetch` calls with a maximum number in flight at once,
 * queuing the rest. Requests start in FIFO order as concurrency slots free
 * up; each call's returned promise resolves independently with its own
 * response once it completes.
 */

type FetchLike = typeof fetch;
type FetchInput = Parameters<FetchLike>[0];
type FetchInit = Parameters<FetchLike>[1];

interface QueuedTask {
  input: FetchInput;
  init: FetchInit;
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
}

export interface RateLimitedFetchQueueOptions {
  maxConcurrent: number;
  /** Injectable fetch implementation, mainly useful for tests. */
  fetchFn?: FetchLike;
}

export class RateLimitedFetchQueue {
  private readonly maxConcurrent: number;
  private readonly fetchFn: FetchLike;
  private readonly queue: QueuedTask[] = [];
  private active = 0;

  constructor(options: RateLimitedFetchQueueOptions) {
    if (options.maxConcurrent < 1) {
      throw new RangeError("maxConcurrent must be at least 1");
    }
    this.maxConcurrent = options.maxConcurrent;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /** Enqueues a fetch call. Resolves/rejects like `fetch` would. */
  enqueue(input: FetchInput, init?: FetchInit): Promise<Response> {
    return new Promise((resolve, reject) => {
      this.queue.push({ input, init, resolve, reject });
      this.drain();
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  get inFlight(): number {
    return this.active;
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      this.active++;
      this.fetchFn(task.input, task.init)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}
