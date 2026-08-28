// x402 tracing — optional observability hooks for the payment flow.
//
// Consumers can attach onSpanStart / onSpanEnd callbacks to get end-to-end
// visibility into every internal boundary (fetch, decode, sign, settle) without
// importing a specific tracing library. The trace context is a plain object
// threaded through the flow — consumers decide how to propagate it (e.g.
// OpenTelemetry, Datadog, or their own logger).
//
// Zero-cost when unconfigured: when no hooks are passed, every call is a no-op.

/** Identifies the phase of the x402 payment flow. */
export type SpanName =
  /** The initial (unpaid) request. */
  | "x402.request"
  /** Decoding the PAYMENT-REQUIRED header. */
  | "x402.decode-requirements"
  /** Selecting the best payment option. */
  | "x402.select-requirements"
  /** Building + signing the SEP-41 transfer. */
  | "x402.build-payment"
  /** Signing one auth entry via the injected signer. */
  | "x402.sign-auth-entry"
  /** Retrying the request with the PAYMENT-SIGNATURE header. */
  | "x402.paid-retry"
  /** Reading the settlement from the paid response. */
  | "x402.read-settlement";

/** The trace context threaded through the entire payment flow. */
export interface X402TraceContext {
  /** Opaque trace identifier — consumers set this (e.g. a UUID or span id). */
  readonly traceId: string;
  /** Arbitrary attributes the consumer wants to attach to every span. */
  readonly attributes?: Record<string, unknown>;
}

/** Data passed to span hooks at the start of a phase. */
export interface SpanStartEvent {
  /** Which phase is starting. */
  readonly name: SpanName;
  /** The trace context (same reference threaded through the flow). */
  readonly trace: X402TraceContext;
  /** Phase-specific metadata. */
  readonly meta?: Record<string, unknown>;
}

/** Data passed to span hooks at the end of a phase. */
export interface SpanEndEvent extends SpanStartEvent {
  /** Whether the phase completed without throwing. */
  readonly ok: boolean;
  /** If the phase threw, the error (never null when ok=false). */
  readonly error?: Error;
  /** Elapsed milliseconds since the matching onSpanStart. */
  readonly durationMs: number;
  /** Phase-specific result metadata. */
  readonly result?: Record<string, unknown>;
}

/** Optional observability hooks for the x402 payment flow. */
export interface X402TracingHooks {
  /** Called at the start of each internal phase. */
  onSpanStart?: (event: SpanStartEvent) => void;
  /** Called at the end of each internal phase. */
  onSpanEnd?: (event: SpanEndEvent) => void;
}

// ── helpers ────────────────────────────────────────────────────────────────

let nextTraceId = 0;

/** Generate a simple monotonically-increasing trace id (no crypto dependency). */
export function generateTraceId(): string {
  return `x402-${++nextTraceId}-${Date.now().toString(36)}`;
}

/**
 * Execute `fn` inside a traced span. Calls onSpanStart before and onSpanEnd
 * after. If fn throws, onSpanEnd is called with ok=false and the error is
 * re-thrown.
 */
export async function tracedSpan<T>(
  hooks: X402TracingHooks | undefined,
  name: SpanName,
  trace: X402TraceContext,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  if (!hooks?.onSpanStart && !hooks?.onSpanEnd) {
    return fn();
  }

  const startEvent: SpanStartEvent = { name, trace, meta };
  hooks.onSpanStart?.(startEvent);

  const t0 = performance.now();
  let ok = true;
  let error: Error | undefined;
  let result: Record<string, unknown> | undefined;

  try {
    const value = await fn();
    return value;
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    const durationMs = performance.now() - t0;
    hooks.onSpanEnd?.({
      name,
      trace,
      meta,
      ok,
      error,
      durationMs,
      result,
    });
  }
}
