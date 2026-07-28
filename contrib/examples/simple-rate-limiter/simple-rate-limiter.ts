// Example: a fixed-window rate limiter keyed by a string id, tracking
// counts in memory.
//
// Run with: npx tsx simple-rate-limiter.ts

interface WindowState {
  count: number;
  windowStart: number;
}

export class SimpleRateLimiter {
  #limit: number;
  #windowMs: number;
  #state = new Map<string, WindowState>();
  #now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /** Returns true and records the call if `key` is under its limit for the
   * current window; returns false without recording if over. A new window
   * starts (and the count resets) once windowMs has elapsed since the
   * window began. */
  isAllowed(key: string): boolean {
    const now = this.#now();
    const state = this.#state.get(key);

    if (!state || now - state.windowStart >= this.#windowMs) {
      this.#state.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (state.count >= this.#limit) {
      return false;
    }

    state.count++;
    return true;
  }
}

function main() {
  const limiter = new SimpleRateLimiter(3, 1000);

  console.log("Calling with key 'user-1' 5 times (limit=3, window=1000ms):");
  for (let i = 1; i <= 5; i++) {
    console.log(`  call ${i}: ${limiter.isAllowed("user-1") ? "allowed" : "rejected"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
