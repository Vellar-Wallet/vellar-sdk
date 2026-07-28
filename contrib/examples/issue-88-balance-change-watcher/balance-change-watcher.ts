/**
 * Balance change watcher (issue #88)
 *
 * Polls a balance source on a fixed interval and emits a "change" event only
 * when the returned value differs from the previously observed value.
 */

export type BalanceSource = () => Promise<string>;
export type ChangeHandler = (newBalance: string, previousBalance: string) => void;

export interface BalanceWatcher {
  subscribe: (handler: ChangeHandler) => void;
  stop: () => void;
}

/**
 * Create a watcher that polls `source` every `intervalMs` milliseconds.
 * Call `subscribe` to register a handler; call `stop` to end polling.
 */
export function createBalanceWatcher(
  source: BalanceSource,
  intervalMs: number = 2000,
): BalanceWatcher {
  let lastBalance: string | null = null;
  const handlers: ChangeHandler[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  async function poll() {
    const balance = await source();
    if (lastBalance !== null && balance !== lastBalance) {
      for (const handler of handlers) {
        handler(balance, lastBalance);
      }
    }
    lastBalance = balance;
  }

  // Run an initial poll immediately, then on the interval.
  poll();
  timer = setInterval(poll, intervalMs);

  return {
    subscribe(handler: ChangeHandler) {
      handlers.push(handler);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
