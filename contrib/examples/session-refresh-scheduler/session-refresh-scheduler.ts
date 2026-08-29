// Example: a self-rescheduling timer that refreshes a wallet session shortly
// BEFORE it is due to expire, then re-arms itself against the expiry of the
// session the refresh returns. Timer-based, mock-driven, no network.
//
// A real Vellar session (vellar-sdk's WalletSession, src/types.ts) tracks
// createdAt / lastActiveAt; an app that mints short-lived x402 session keys
// layers an expiry on top of that. This example models the expiry with an
// `expiresAt` ISO timestamp and keeps the session alive by refreshing just
// before it lapses — so a long-running agent never presents an expired key.
//
// Run with: npx tsx session-refresh-scheduler.ts

/** The only slice of session state this scheduler needs: when it expires. */
export interface ExpiringSession {
  /** ISO 8601 timestamp at which the session expires. */
  expiresAt: string;
}

/** Produces the next session (e.g. by minting a fresh session key). */
export type RefreshFn = () => Promise<ExpiringSession>;

export interface SchedulerOptions {
  /** How long before expiry to fire the refresh, in milliseconds. */
  leadTimeMs: number;
  /** Clock source, injectable for tests. Defaults to Date.now. */
  now?: () => number;
  /** Called when a scheduled refresh throws. Defaults to console.error. */
  onError?: (err: unknown) => void;
}

export interface RefreshScheduler {
  /** Stop the scheduler and clear any pending refresh timer. */
  stop(): void;
}

/**
 * Starts a self-rescheduling refresh loop. It arms a timer to fire
 * `leadTimeMs` before `session.expiresAt`; when the timer fires it calls
 * `refresh()`, then re-arms against the expiry of the session that returns.
 *
 * If the session already expires within the lead time, the refresh fires
 * immediately (the delay is clamped to 0). A refresh that throws is reported
 * via `onError` and ends the loop (no further reschedule) — the caller can
 * restart with a fresh session.
 */
export function startRefreshScheduler(
  session: ExpiringSession,
  refresh: RefreshFn,
  options: SchedulerOptions,
): RefreshScheduler {
  const now = options.now ?? (() => Date.now());
  const reportError =
    options.onError ?? ((err: unknown) => console.error("scheduled refresh failed:", err));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function delayUntilRefresh(current: ExpiringSession): number {
    const expiry = new Date(current.expiresAt).getTime();
    if (Number.isNaN(expiry)) {
      throw new RangeError(`"${current.expiresAt}" is not a valid ISO timestamp`);
    }
    return Math.max(0, expiry - options.leadTimeMs - now());
  }

  function arm(current: ExpiringSession): void {
    if (stopped) return;
    const delay = delayUntilRefresh(current);
    timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await refresh();
          arm(next); // reschedule against the new expiry
        } catch (err) {
          reportError(err);
        }
      })();
    }, delay);
  }

  arm(session);

  return {
    stop() {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

async function main(): Promise<void> {
  const lifetimeMs = 400;
  const leadTimeMs = 150;
  let generation = 0;

  const mint = (): ExpiringSession => {
    generation += 1;
    const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
    console.log(`[mint]    session #${generation} expires at ${expiresAt}`);
    return { expiresAt };
  };

  const refresh: RefreshFn = async () => {
    console.log(`[refresh] refreshing session #${generation} before it expires`);
    return mint();
  };

  console.log(`Starting scheduler (lifetime ${lifetimeMs}ms, refresh ${leadTimeMs}ms before expiry)`);
  const scheduler = startRefreshScheduler(mint(), refresh, { leadTimeMs });

  // Run long enough to observe at least two reschedules, then stop.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  scheduler.stop();
  console.log(`[stop]    scheduler stopped after ${generation} generations`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
