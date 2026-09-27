// Facilitator health probe and circuit breaker for x402 (#419).
//
// Applies createCircuitBreaker from src/circuit-breaker.ts to the x402 payment path.
//
// Deliberate failure criteria:
//   - A 402 Payment Required response is a normal negotiation step, NOT a failure.
//   - A PaymentRejectedError (deterministic policy refusal or budget limit) is NOT
//     a downstream outage, so it must not trip the breaker.
//   - Client-side validation errors (e.g. DisallowedAssetError) do NOT trip the breaker.
//   - Only transport-level failures (network drops, connection refused) and HTTP 5xx
//     server errors count as downstream outages.
//
// When open, CircuitOpenError fast-fails without attempting payment or spending funds.

import {
  createCircuitBreaker,
  CircuitOpenError,
  type CircuitBreaker,
  type CircuitBreakerOptions,
} from "../../src/circuit-breaker";

export { CircuitOpenError };
export type { CircuitBreaker, CircuitBreakerOptions };

export class FacilitatorServerError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `Facilitator service error (HTTP ${status}).`);
    this.name = "FacilitatorServerError";
  }
}

export class PaymentRejectedError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "PaymentRejectedError";
  }
}

export interface X402ExecutionResult {
  ok: boolean;
  status?: number;
  error?: unknown;
}

/**
 * Determine whether a result or error from the x402 path counts as a circuit breaker failure.
 *
 * Reasoning:
 * - 402 challenge: standard protocol handshake, not an error.
 * - PaymentRejectedError: deterministic policy refusal from on-chain limits or seller rules,
 *   proving the facilitator IS responding.
 * - Transport error or 5xx: downstream facilitator/network failure.
 */
export function isFacilitatorFailure(result: X402ExecutionResult): boolean {
  if (result.ok) {
    if (result.status && result.status >= 500) {
      return true;
    }
    return false;
  }

  const err = result.error;
  if (!err) return false;

  if (err instanceof PaymentRejectedError) {
    return false;
  }

  if (err instanceof CircuitOpenError) {
    return false;
  }

  if (err instanceof FacilitatorServerError) {
    return true;
  }

  // Any other thrown error is a transport-level failure (FetchError, network drop, timeout)
  return true;
}

/**
 * Wrap an x402 payment/fetch function with circuit breaker protection.
 * Fast-fails with CircuitOpenError when open without attempting payments.
 */
export function withX402CircuitBreaker<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  options: CircuitBreakerOptions = {},
): {
  execute: (...args: TArgs) => Promise<TReturn>;
  breaker: CircuitBreaker;
} {
  const breaker = createCircuitBreaker({
    ...options,
    isFailure: (res) => isFacilitatorFailure(res as unknown as X402ExecutionResult),
  });

  async function execute(...args: TArgs): Promise<TReturn> {
    try {
      return await breaker.execute(() => fn(...args));
    } catch (err: unknown) {
      if (err instanceof CircuitOpenError) {
        throw new CircuitOpenError(
          "The vellar-facilitator circuit is open (downstream outage); call refused. No payment was attempted and nothing was spent.",
        );
      }
      throw err;
    }
  }

  return { execute, breaker };
}
