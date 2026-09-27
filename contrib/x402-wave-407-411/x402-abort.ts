// Abort-signal wrapper for the x402 fetch path (#410).
//
// X402FetchInit.requestInit.signal already reaches the initial probe and the
// paid retry. It does not reach AssembledTransaction.build or
// getLatestLedger, so an abort after the 402 leaves RPC work running.
//
// This wrapper:
//   - refuses an already-aborted signal BEFORE any network call
//   - maps a mid-flow AbortError to a typed X402AbortedError
//   - after the inner fetch has produced a signed payment, abort still
//     cancels the retry but paymentMayHaveBeenSigned is true — a signed
//     payload can still settle if it already left the process
//
// Lift the helpers into src/x402-client.ts so simulation and
// getLatestLedger honour the same signal.

import type { X402Client, X402FetchInit, X402Response } from "../../src/x402-types";

/**
 * The caller aborted the x402 payment flow via AbortSignal.
 *
 * `paymentMayHaveBeenSigned` is the fact a caller must branch on: false is
 * a clean cancel; true means at least one auth entry was signed before the
 * abort. This wrapper will not send the paid retry, but a signed payload
 * can still settle if it already left the process.
 */
export class X402AbortedError extends Error {
  readonly name = "X402AbortedError";
  constructor(readonly paymentMayHaveBeenSigned: boolean) {
    super(
      paymentMayHaveBeenSigned
        ? "x402 payment flow aborted after a payment may have been signed"
        : "x402 payment flow aborted before any payment was signed",
    );
  }
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  paymentMayHaveBeenSigned: boolean,
): void {
  if (signal?.aborted) throw new X402AbortedError(paymentMayHaveBeenSigned);
}

function isAbortError(err: unknown): boolean {
  if (err instanceof X402AbortedError) return true;
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: string }).name === "AbortError"
  );
}

export type FetchLike = (url: string, init: X402FetchInit) => Promise<X402Response>;

/**
 * Honour requestInit.signal for the whole fetch wrapper. `signed` tells the
 * wrapper whether a signature has already been produced (the dangerous
 * post-signature / pre-retry window).
 */
export function withAbortSignal(fetchFn: FetchLike, signed = () => false): FetchLike {
  return async (url, init) => {
    const signal = init.requestInit?.signal;
    throwIfAborted(signal, false);
    try {
      return await fetchFn(url, init);
    } catch (err) {
      if (err instanceof X402AbortedError) throw err;
      if (isAbortError(err)) throw new X402AbortedError(signed());
      throw err;
    }
  };
}

/** Wrap a client's fetch so an already-aborted signal never hits the wire. */
export function withClientAbortSignal<T extends Pick<X402Client, "fetch">>(client: T): T {
  return { ...client, fetch: withAbortSignal(client.fetch.bind(client)) };
}
