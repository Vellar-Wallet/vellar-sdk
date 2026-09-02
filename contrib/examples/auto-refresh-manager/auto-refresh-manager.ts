// Example (capstone): a single exported AutoRefreshManager class that composes
// three concerns into one cohesive component:
//
//   - a session STORE      (holds the current session; cf. memory-session-store)
//   - an expiry WATCHER    (is it expired / how long left; cf. session-expiry-check)
//   - a refresh SCHEDULER  (refresh just before expiry; cf. session-refresh-scheduler, #74)
//
// The result is a session that is transparently refreshed BEFORE it would ever
// expire, so a long-running agent always holds a live key. Mock-driven, no
// network. It reuses vellar-sdk's real `WalletSession` (src/types.ts) and layers
// an `expiresAt` on top (the SDK's WalletSession tracks activity timestamps; an
// app that mints short-lived x402 session keys adds the expiry).
//
// Run with: npx tsx auto-refresh-manager.ts

import type { WalletSession } from "../../../src/types";

/** A WalletSession plus the expiry this manager schedules against. */
export interface ManagedSession extends WalletSession {
  /** ISO 8601 timestamp at which the session (key) must be rotated. */
  expiresAt: string;
}

export interface AutoRefreshOptions {
  /** Fire the refresh this many milliseconds before expiry. */
  leadTimeMs: number;
  /** Mint the next session (rotate the key, extend expiry). */
  refresh: (previous: ManagedSession) => Promise<ManagedSession>;
  /** Clock source, injectable for tests. Defaults to Date.now. */
  now?: () => number;
  /** Called when a refresh throws. Defaults to console.error. */
  onError?: (err: unknown) => void;
}

/**
 * Combines a session store, an expiry watcher, and a refresh scheduler behind
 * one class. Call `start(session)` to begin; the manager keeps the stored
 * session refreshed until you `stop()`.
 */
export class AutoRefreshManager {
  // --- store (cf. memory-session-store) ---
  private session: ManagedSession | null = null;

  // --- scheduler (cf. session-refresh-scheduler / issue #74) ---
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  private readonly leadTimeMs: number;
  private readonly refresh: (previous: ManagedSession) => Promise<ManagedSession>;
  private readonly now: () => number;
  private readonly onError: (err: unknown) => void;

  constructor(options: AutoRefreshOptions) {
    this.leadTimeMs = options.leadTimeMs;
    this.refresh = options.refresh;
    this.now = options.now ?? (() => Date.now());
    this.onError = options.onError ?? ((err) => console.error("auto-refresh failed:", err));
  }

  /** Begin managing `session`: store it and arm the refresh timer. */
  start(session: ManagedSession): void {
    this.stopped = false;
    this.setSession(session);
    this.arm();
  }

  /** The current session, or null before start() / after stop(). (store) */
  getSession(): ManagedSession | null {
    return this.session;
  }

  /** Whether the stored session has passed its expiry. (watcher) */
  isExpired(): boolean {
    if (!this.session) return true;
    return this.expiryOf(this.session) <= this.now();
  }

  /** Milliseconds until the stored session expires (negative if past). (watcher) */
  msUntilExpiry(): number {
    if (!this.session) return 0;
    return this.expiryOf(this.session) - this.now();
  }

  /** Stop the manager and clear any pending refresh timer. (scheduler) */
  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // --- internals ---

  private setSession(session: ManagedSession): void {
    this.session = session;
  }

  private expiryOf(session: ManagedSession): number {
    const t = new Date(session.expiresAt).getTime();
    if (Number.isNaN(t)) {
      throw new RangeError(`"${session.expiresAt}" is not a valid ISO timestamp`);
    }
    return t;
  }

  private arm(): void {
    if (this.stopped || !this.session) return;
    const delay = Math.max(0, this.expiryOf(this.session) - this.leadTimeMs - this.now());
    this.timer = setTimeout(() => {
      void this.runRefresh();
    }, delay);
  }

  private async runRefresh(): Promise<void> {
    const current = this.session;
    if (this.stopped || !current) return;
    try {
      const next = await this.refresh(current);
      if (this.stopped) return;
      this.setSession(next); // store update
      this.arm(); // reschedule against the new expiry
    } catch (err) {
      this.onError(err);
    }
  }
}

// --- runnable demo -----------------------------------------------------------

function makeSession(expiresInMs: number, keyId: string): ManagedSession {
  const nowIso = new Date().toISOString();
  return {
    accountId: "CABC123SAMPLEWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXX",
    network: "testnet",
    connected: true,
    authMethod: "passkey",
    createdAt: nowIso,
    lastActiveAt: nowIso,
    keyId,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  };
}

async function main(): Promise<void> {
  const lifetimeMs = 400;
  const leadTimeMs = 150;
  let generation = 1;

  const manager = new AutoRefreshManager({
    leadTimeMs,
    refresh: async (previous) => {
      generation += 1;
      console.log(`[refresh] rotating ${previous.keyId} -> key-${generation} before expiry`);
      return makeSession(lifetimeMs, `key-${generation}`);
    },
  });

  console.log(`Starting manager (lifetime ${lifetimeMs}ms, refresh ${leadTimeMs}ms before expiry)`);
  manager.start(makeSession(lifetimeMs, "key-1"));
  console.log(`[start]   session ${manager.getSession()?.keyId}, expires ${manager.getSession()?.expiresAt}`);

  // Sample the manager a few times across a window longer than one lifetime.
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const s = manager.getSession();
    console.log(
      `[poll]    key=${s?.keyId} expired=${manager.isExpired()} msLeft=${Math.round(manager.msUntilExpiry())}`,
    );
  }

  manager.stop();
  console.log(`[stop]    stopped after ${generation} generations; final key=${manager.getSession()?.keyId}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
