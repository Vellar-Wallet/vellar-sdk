// Circuit breaker for calls to the vellar-facilitator service.
//
// EVERY call the client makes to the facilitator (wallet create/connect
// submission, transaction submission) funnels through the wallet's backend. If
// that downstream service is down, every consumer call would otherwise hang on
// the network or fail slowly, one at a time. The breaker keeps a failing
// downstream from turning every consumer call into a slow failure:
//
//   CLOSED  → healthy; each call passes through and is counted.
//             After `failureThreshold` consecutive failures the breaker OPENS.
//   OPEN    → calls fail immediately with a fast, typed `CircuitOpenError`
//             (no network hop). After `openDurationMs` the breaker moves to
//             HALF-OPEN to probe whether the downstream recovered.
//   HALF-OPEN → a limited number of trial calls are allowed through. A success
//             closes the breaker; a failure reopens it.

/** Time-based breaker clock seam so tests can control `Date.now()` (defaults to
 * the real clock; tests pass a fake to drive state transitions deterministically). */
export type CircuitBreakerClock = () => number;

export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures that trip the breaker CLOSED → OPEN.
   * Higher = more forgiving (keeps trying through transient blips), lower =
   * fail faster. Default 5.
   */
  failureThreshold?: number;
  /** How long the breaker stays OPEN before probing in HALF-OPEN. Default 30s. */
  openDurationMs?: number;
  /** How many trial calls HALF-OPEN allows through before re-evaluating. Default 1. */
  halfOpenMaxCalls?: number;
  /** What counts as a failure. A rejected promise is always a failure; custom
   * predicates let a backend treat e.g. a 4xx API error as a transient blip
   * rather than a service outage. Default: none (any rejection fails). */
  isFailure?: (result: { ok: boolean; error?: unknown }) => boolean;
  /** Injectable clock for tests. */
  now?: CircuitBreakerClock;
}

export type CircuitBreakerState = "closed" | "open" | "half-open";

/**
 * Fast-fail error thrown when a call is made while the breaker is OPEN. Typed so
 * callers can distinguish a refused (outage) call from a real downstream error.
 */
export class CircuitOpenError extends Error {
  constructor(message = "The vellar-facilitator circuit is open (downstream outage); call refused.") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export interface CircuitBreaker {
  /** Current state. */
  get state(): CircuitBreakerState;
  /** Number of consecutive failures currently recorded. */
  get failureCount(): number;
  /** Run `fn` under the breaker, or throw {@link CircuitOpenError} when OPEN. */
  execute<T>(fn: () => Promise<T>): Promise<T>;
  /** Force the breaker back to a healthy CLOSED state (e.g. explicit recovery). */
  reset(): void;
}

export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const failureThreshold = options.failureThreshold ?? 5;
  const openDurationMs = options.openDurationMs ?? 30_000;
  const halfOpenMaxCalls = options.halfOpenMaxCalls ?? 1;
  const isFailure = options.isFailure;
  const now = options.now ?? (() => Date.now());

  // Reading state lazily keeps `state()` honest even after simulateState jumps
  // the clock. These transaction-level numbers reset on success, so a single
  // success is enough to CLOSE again.
  let state: CircuitBreakerState = "closed";
  let failures = 0;
  let openedAt = 0;
  let halfOpenUsed = 0;

  function open(): void {
    state = "open";
    openedAt = now();
    failures = failureThreshold;
  }

  function halfOpen(): void {
    state = "half-open";
    halfOpenUsed = 0;
  }

  function close(): void {
    state = "closed";
    failures = 0;
    openedAt = 0;
    halfOpenUsed = 0;
  }

  function recordFailure(): void {
    failures++;
    if (state === "half-open" && failures >= 1) {
      // A failed trial reopens immediately.
      open();
      return;
    }
    if (failures >= failureThreshold) {
      open();
    }
  }

  function classify(result: { error?: unknown; ok?: boolean }): void {
    if (isFailure) {
      if (isFailure({ ok: result.ok === true, error: result.error })) recordFailure();
      else close();
      return;
    }
    if (result.error !== undefined) recordFailure();
    else close();
  }

  return {
    get state() {
      // A HALF-OPEN breaker reopens automatically when the cooldown elapsed
      // without any probing call happening to observe it.
      if (state === "open" && now() - openedAt >= openDurationMs) {
        halfOpen();
      }
      return state;
    },
    get failureCount() {
      return failures;
    },
    reset() {
      close();
    },
    async execute(fn) {
      // Lazy read so the OPEN → HALF-OPEN transition above takes effect before
      // we decide to allow a trial call or fast-fail.
      if (this.state === "open") {
        throw new CircuitOpenError();
      }
      if (this.state === "half-open") {
        if (halfOpenUsed >= halfOpenMaxCalls) {
          // Limited trials only: extra calls during the probe fast-fail too.
          throw new CircuitOpenError(
            "The vellar-facilitator circuit is half-open and trial calls are exhausted; call refused.",
          );
        }
        halfOpenUsed++;
      }
      try {
        const result = await fn();
        classify({ ok: true });
        return result;
      } catch (error) {
        classify({ error });
        throw error;
      }
    },
  };
}

/**
 * Wrap a backend object so every facilitator call is protected by the same
 * circuit breaker. Returns a shallow clone of `backend` whose method names we
 * recognise (submitWalletCreation, lookupContractId, submitTransaction,
 * submitWalletDeployment — anything returning a promise) are routed through the
 * breaker. Unknown/non-callable properties pass through unchanged.
 */
export function createCircuitBreakingBackend<T extends object>(
  backend: T,
  breaker: CircuitBreaker = createCircuitBreaker(),
): T {
  const record = backend as Record<string, unknown>;
  const wrapped = { ...record } as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === "function") {
      wrapped[key] = (...args: unknown[]) =>
        breaker.execute(() => (value as (...a: unknown[]) => Promise<unknown>)(...args));
    }
  }
  return wrapped as T;
}
