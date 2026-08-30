/**
 * Telemetry for x402 payment completion.
 *
 * Contributed for issue #296: an x402 payment completing is not currently
 * tracked as a telemetry event, leaving a gap in consumer usage insight.
 * `wallet.x402.fetch()` returns `{ response, paid, settlement }` and that is
 * the end of it — a host that wants to know how much its agents are spending
 * has to instrument every call site itself.
 *
 * This is the event, plus the wrapper that emits it, written against the real
 * `X402Response` shape so it can wrap `wallet.x402` today and move into
 * `src/x402-client.ts` unchanged.
 *
 * ── Design rules, in the order they mattered ─────────────────────────────
 *
 * 1. TELEMETRY MUST NEVER BREAK A PAYMENT. A payment that settled on-chain
 *    has already moved real money. If the emitter throws — a bad sink, a
 *    serialization bug, an analytics SDK that is down — the caller must still
 *    get their `X402Response`. Every emit is wrapped, and a throwing sink is
 *    reported through `onError` rather than propagated. There is no
 *    configuration that makes telemetry able to fail a settled payment.
 *
 * 2. IT MUST NOT LEAK SECRETS. The event carries the resource URL, the
 *    settlement hash, the asset, and the amount. It deliberately does NOT
 *    carry request headers or bodies: `PAYMENT-SIGNATURE` is a signed
 *    authorization, and the SDK already treats leaking it as a security bug
 *    (see `packages/mcp-x402-payer/src/output.ts`). URLs are stripped of
 *    query and fragment by default, because API keys live in query strings.
 *
 * 3. AMOUNTS STAY EXACT. Base-unit amounts are `bigint` throughout the SDK
 *    and a stroop-precision value can exceed `Number.MAX_SAFE_INTEGER`. The
 *    event keeps the `bigint`, and `toJSON()` renders it as a decimal string
 *    rather than a lossy `Number`.
 *
 * 4. ONLY REAL PAYMENTS COUNT. A 402-free resource resolves with
 *    `paid: false`; that is a cache hit, not a payment, and emitting it would
 *    inflate every "payments made" metric a consumer builds on this.
 */

/** Minimal shape of what `wallet.x402.fetch()` resolves with. */
export interface X402SettlementLike {
  /** On-chain settlement transaction hash. */
  transaction: string;
  /** The payer C-address. */
  payer: string;
  asset: string;
  amount: bigint;
  network: string;
}

export interface X402ResponseLike {
  response: { status: number };
  paid: boolean;
  settlement?: X402SettlementLike;
}

/** Emitted once per x402 payment that actually settled. */
export interface X402PaymentCompletedEvent {
  /** Discriminator, so one sink can multiplex several event types. */
  readonly type: "x402.payment.completed";
  /**
   * The resource that was paid for — the issue's "resource id".
   * Sanitized per `resourceIdMode`; never carries a query string by default.
   */
  readonly resourceId: string;
  /** Amount paid in base units. `bigint` so stroop precision is exact. */
  readonly amount: bigint;
  /** SEP-41 asset contract the payment was denominated in. */
  readonly asset: string;
  /** Network the settlement landed on. */
  readonly network: string;
  /** On-chain settlement transaction hash. */
  readonly transaction: string;
  /** The payer C-address. */
  readonly payer: string;
  /** Status of the unlocked resource response (2xx). */
  readonly status: number;
  /** Wall-clock time the payment completed, epoch ms. */
  readonly timestamp: number;
  /** End-to-end duration of the paid fetch, ms, when measured. */
  readonly durationMs?: number;
}

/**
 * How much of the resource URL to record.
 *
 * - `path` (default) — origin + pathname. Drops query and fragment, where API
 *   keys and session tokens live.
 * - `origin` — origin only. For hosts that treat paths as sensitive.
 * - `full` — the URL verbatim. Opt-in, and only safe when you control the
 *   resource URLs and know they carry no credentials.
 */
export type ResourceIdMode = "path" | "origin" | "full";

/** Receives completed-payment events. May be async; errors are contained. */
export type X402TelemetrySink = (event: X402PaymentCompletedEvent) => void | Promise<void>;

export interface X402TelemetryOptions {
  /** Where events go. Omit to disable telemetry entirely. */
  sink?: X402TelemetrySink;
  /** URL detail recorded as `resourceId`. @default "path" */
  resourceIdMode?: ResourceIdMode;
  /**
   * Called when the sink throws or rejects. Telemetry failures are contained,
   * never propagated — this is how you find out one happened.
   */
  onError?: (error: unknown, event: X402PaymentCompletedEvent) => void;
  /** Injected clock, for tests. @default Date.now */
  now?: () => number;
}

/**
 * Reduce a resource URL to what is safe to record.
 *
 * A URL that doesn't parse is returned with any query and fragment cut off
 * lexically — an unparseable URL is still not a reason to log a raw secret.
 */
export function sanitizeResourceId(url: string, mode: ResourceIdMode = "path"): string {
  if (mode === "full") return url;
  try {
    const parsed = new URL(url);
    return mode === "origin" ? parsed.origin : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/**
 * Build the completion event for a settled payment.
 *
 * Returns `undefined` when nothing was paid — either `paid` is false, or there
 * is no settlement to report. Callers treat `undefined` as "do not emit".
 */
export function buildPaymentCompletedEvent(
  url: string,
  result: X402ResponseLike,
  options: { resourceIdMode?: ResourceIdMode; now?: () => number; durationMs?: number } = {},
): X402PaymentCompletedEvent | undefined {
  // A 402-free resource is a cache hit, not a payment.
  if (!result.paid || !result.settlement) return undefined;

  const { settlement } = result;
  const now = options.now ?? Date.now;

  return {
    type: "x402.payment.completed",
    resourceId: sanitizeResourceId(url, options.resourceIdMode ?? "path"),
    amount: settlement.amount,
    asset: settlement.asset,
    network: settlement.network,
    transaction: settlement.transaction,
    payer: settlement.payer,
    status: result.response.status,
    timestamp: now(),
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
  };
}

/**
 * Render an event as JSON-safe values.
 *
 * `bigint` has no JSON representation, so `JSON.stringify(event)` throws —
 * a trap worth removing, since most sinks serialize. `amount` becomes a
 * decimal string, which keeps stroop precision that `Number` would lose.
 */
export function toJSON(
  event: X402PaymentCompletedEvent,
): Record<string, string | number | undefined> {
  return {
    type: event.type,
    resourceId: event.resourceId,
    amount: event.amount.toString(),
    asset: event.asset,
    network: event.network,
    transaction: event.transaction,
    payer: event.payer,
    status: event.status,
    timestamp: event.timestamp,
    durationMs: event.durationMs,
  };
}

/** The `fetch` half of `X402Client` — what this wrapper decorates. */
export type X402FetchLike<TInit, TResult extends X402ResponseLike> = (
  url: string,
  init: TInit,
) => Promise<TResult>;

/**
 * Wrap an x402 `fetch` so every completed payment emits one event.
 *
 * The returned function has the same signature and resolves with the same
 * value, so it is a drop-in replacement:
 *
 *     wallet.x402.fetch = withPaymentTelemetry(wallet.x402.fetch, { sink });
 *
 * Guarantees, in order of importance:
 *
 *   - a throwing or rejecting sink never fails the payment;
 *   - a failed fetch emits nothing and rethrows untouched;
 *   - an unpaid (cache-hit) response emits nothing;
 *   - the emit happens after the result is in hand, so nothing is reported
 *     for a payment that didn't complete.
 */
export function withPaymentTelemetry<TInit, TResult extends X402ResponseLike>(
  fetchImpl: X402FetchLike<TInit, TResult>,
  options: X402TelemetryOptions = {},
): X402FetchLike<TInit, TResult> {
  const { sink, resourceIdMode, onError, now = Date.now } = options;

  // No sink means no work at all — not even a wrapper allocation per call.
  if (!sink) return fetchImpl;

  return async (url, init) => {
    const startedAt = now();
    // A rejected fetch propagates untouched: there is no payment to report.
    const result = await fetchImpl(url, init);

    const event = buildPaymentCompletedEvent(url, result, {
      resourceIdMode,
      now,
      durationMs: now() - startedAt,
    });
    if (event) emitSafely(sink, event, onError);

    return result;
  };
}

/**
 * Invoke a sink so it can never break the caller.
 *
 * Covers both failure modes: a synchronous throw, and a rejected promise from
 * an async sink. The promise is deliberately not awaited — a slow analytics
 * call must not add latency to a payment that already settled — so its
 * rejection is caught here rather than surfacing as an unhandled rejection.
 */
function emitSafely(
  sink: X402TelemetrySink,
  event: X402PaymentCompletedEvent,
  onError?: (error: unknown, event: X402PaymentCompletedEvent) => void,
): void {
  const report = (error: unknown): void => {
    try {
      onError?.(error, event);
    } catch {
      // An onError that itself throws is out of options — swallowing is the
      // only remaining behaviour that keeps the payment intact.
    }
  };

  try {
    const maybePromise = sink(event);
    if (maybePromise && typeof (maybePromise as Promise<void>).catch === "function") {
      void (maybePromise as Promise<void>).catch(report);
    }
  } catch (error) {
    report(error);
  }
}

/**
 * A sink that accumulates events in memory — useful in tests, and as a
 * spend-report source for a short-lived agent session.
 */
export function createMemorySink(): {
  sink: X402TelemetrySink;
  events: X402PaymentCompletedEvent[];
  /** Total base units paid across every recorded event for `asset`. */
  totalFor(asset: string): bigint;
} {
  const events: X402PaymentCompletedEvent[] = [];
  return {
    sink: (event) => {
      events.push(event);
    },
    events,
    totalFor(asset) {
      return events
        .filter((e) => e.asset === asset)
        .reduce((sum, e) => sum + e.amount, 0n);
    },
  };
}
