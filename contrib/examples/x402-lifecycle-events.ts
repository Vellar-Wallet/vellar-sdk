/**
 * x402 payment lifecycle events — reference implementation for #456.
 *
 * An optional callback seam reporting stage transitions during the x402
 * payment flow, with duration tracking for each stage.
 *
 * Rule: callbacks never include key material, raw signatures, or signed payloads.
 * A throwing callback is caught and must not fail the payment.
 *
 * This file is a self-contained example; the real module would live in src/.
 */

export type X402Stage =
  | "challenge_received"
  | "option_selected"
  | "transaction_built"
  | "auth_entry_validated"
  | "signature_produced"
  | "paid_retry_sent"
  | "settlement_classified";

export interface X402LifecycleEvent {
  stage: X402Stage;
  /** Duration of this stage in milliseconds. */
  durationMs: number;
  /** Timestamp when this stage started (ms since epoch). */
  startedAt: number;
  /** Timestamp when this stage completed (ms since epoch). */
  completedAt: number;
}

export type X402LifecycleCallback = (event: X402LifecycleEvent) => void;

/**
 * Create a lifecycle tracker that wraps a callback and ensures:
 * 1. Every stage boundary emits an event with duration.
 * 2. A throwing callback is caught and never fails the payment.
 * 3. No key material or signatures are ever passed to the callback.
 */
export function createLifecycleTracker(callback?: X402LifecycleCallback) {
  const stages: X402LifecycleEvent[] = [];
  let stageStart = Date.now();

  function mark(stage: X402Stage): void {
    const now = Date.now();
    const event: X402LifecycleEvent = {
      stage,
      durationMs: now - stageStart,
      startedAt: stageStart,
      completedAt: now,
    };
    stages.push(event);
    stageStart = now;

    if (callback) {
      try {
        callback(event);
      } catch {
        // Observability must never break the money path.
      }
    }
  }

  function getStages(): readonly X402LifecycleEvent[] {
    return stages;
  }

  return { mark, getStages };
}