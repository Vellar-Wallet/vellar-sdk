/**
 * Watches a session object with an `expiresAt` timestamp and invokes a
 * callback shortly before it expires, using a single timer.
 */

export interface SessionLike {
  expiresAt: number; // epoch milliseconds
}

export interface SessionExpiryWatcherOptions {
  /** How many milliseconds before expiry the callback should fire. */
  warnBeforeMs: number;
  /** Called once, shortly before the session expires. */
  onExpiringSoon: (session: SessionLike) => void;
  /** Injectable clock, mainly useful for tests. */
  now?: () => number;
}

export class SessionExpiryWatcher {
  private readonly session: SessionLike;
  private readonly options: SessionExpiryWatcherOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(session: SessionLike, options: SessionExpiryWatcherOptions) {
    this.session = session;
    this.options = options;
  }

  /** Starts (or restarts) the watcher's timer. */
  start(): void {
    this.stop();

    const now = (this.options.now ?? Date.now)();
    const fireAt = this.session.expiresAt - this.options.warnBeforeMs;
    const delay = Math.max(0, fireAt - now);

    this.timer = setTimeout(() => {
      this.timer = null;
      this.options.onExpiringSoon(this.session);
    }, delay);
  }

  /** Stops the watcher and clears its timer, if any. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }
}
