/**
 * Explicit confirmation for high-value x402 payments.
 *
 * Contributed for issue #228: payments authorized through the x402 signer
 * only ever check `maxAmount` (a client-side ceiling) and the on-chain
 * spending-limit policy (the durable budget) — neither is a per-payment
 * "ask before this one" gate. A caller who wants to auto-pay small amounts
 * but require explicit confirmation above some threshold has no seam for
 * that today.
 *
 * This wraps any `X402Client` (the public interface `createX402Client`
 * returns — see `src/x402-types.ts`) with a confirmation gate: a payment
 * whose amount meets or exceeds `confirmationThreshold` blocks on a
 * `confirm` callback before the wrapped client ever signs it.
 *
 * `createPayment(requirements, opts)` is the clean case — the amount is
 * right there on `requirements.amount`, decoded and checked before
 * delegating.
 *
 * `fetch(url, init)` is architecturally harder to wrap from the OUTSIDE:
 * `X402Client.fetch` decodes the 402 and retries with the signed payment in
 * one call, so nothing about the amount is observable until it's already
 * signing. This wrapper's `fetch` does its own preliminary request to see
 * the 402 and decode the amount (via the SDK's public `x402-guards` exports
 * — `decodePaymentRequired` / `selectRequirements` are legitimate public
 * API, not internals), confirms if needed, and only then delegates to the
 * wrapped client's real `fetch`, which redoes that same request. That
 * SECOND round-trip to the resource is the real cost of gating this
 * interface from outside rather than inside `createX402Client` itself — see
 * the README's "Limits" section.
 *
 * Run with: npx vitest run contrib/examples/issue-228-x402-confirmation-threshold
 */

import {
  decodePaymentRequired,
  selectRequirements,
  parseAmount,
  type PaymentRequirements,
  type X402PayOptions,
} from "../../../src/x402-guards";
import type {
  X402Client,
  X402FetchInit,
  X402Response,
  SignedPayment,
} from "../../../src/x402-types";

/** What a caller reviews before approving a high-value payment. */
export interface PendingConfirmation {
  amount: bigint;
  asset: string;
  requirements: PaymentRequirements;
}

export interface ConfirmationThresholdOptions {
  /**
   * Any payment whose amount (base units) meets or exceeds this requires
   * `confirm` to resolve `true` before the wrapped client signs it.
   */
  confirmationThreshold: bigint;
  /**
   * Resolve `true` to proceed with a payment that crossed the threshold, or
   * `false` to refuse it. The wrapper blocks signing until this settles.
   */
  confirm: (pending: PendingConfirmation) => Promise<boolean>;
  /**
   * The CAIP-2 network id to match 402 offers against on the `fetch` path
   * (e.g. "stellar:testnet") — needed to decode the same option the wrapped
   * client itself would pick, via the SDK's own `selectRequirements`. Get
   * this from `CAIP2_BY_NETWORK[network]` (also exported by `x402-guards`).
   */
  ourCaip2: string;
}

/**
 * A payment crossed `confirmationThreshold` and `confirm` resolved `false`.
 * Nothing was signed.
 */
export class PaymentNotConfirmedError extends Error {
  constructor(
    readonly required: bigint,
    readonly threshold: bigint,
    readonly asset: string,
  ) {
    super(
      `x402 payment of ${required} (${asset}) crosses confirmationThreshold ${threshold} ` +
        "and was declined via `confirm`; refusing to sign.",
    );
    this.name = "PaymentNotConfirmedError";
  }
}

function needsConfirmation(amount: bigint, threshold: bigint): boolean {
  return amount >= threshold;
}

async function requestConfirmation(
  requirements: PaymentRequirements,
  amount: bigint,
  options: ConfirmationThresholdOptions,
): Promise<void> {
  if (!needsConfirmation(amount, options.confirmationThreshold)) return;
  const approved = await options.confirm({ amount, asset: requirements.asset, requirements });
  if (!approved) {
    throw new PaymentNotConfirmedError(amount, options.confirmationThreshold, requirements.asset);
  }
}

/**
 * Wrap an `X402Client` so any payment at/above `confirmationThreshold`
 * blocks on `confirm` before the underlying client signs it. A payment
 * below the threshold passes straight through — `confirm` is never called,
 * so wrapping a client you don't want a threshold on for a given call is a
 * no-op (pass a threshold higher than any real payment, or don't wrap it).
 */
export function withConfirmationThreshold(
  client: X402Client,
  options: ConfirmationThresholdOptions,
): X402Client {
  return {
    async createPayment(
      requirements: PaymentRequirements,
      opts: X402PayOptions,
    ): Promise<SignedPayment> {
      const amount = parseAmount(requirements.amount);
      await requestConfirmation(requirements, amount, options);
      return client.createPayment(requirements, opts);
    },

    async fetch(url: string, init: X402FetchInit): Promise<X402Response> {
      // Preliminary request: see whether this resource even needs payment,
      // and if so, decode which option the wrapped client would pick — all
      // read-only, no state changed by this call.
      const probe = await fetch(url, {
        method: init.method ?? "GET",
        headers: init.headers,
      });

      if (probe.status !== 402) {
        // No payment needed. The probe response itself isn't a valid
        // replacement for the real (non-preflight) request that init.body
        // etc. would produce, so delegate to the wrapped client for the
        // real thing rather than trying to reuse this one.
        return client.fetch(url, init);
      }

      const decoded = decodePaymentRequired(probe);
      const requirements = selectRequirements(decoded, init, options.ourCaip2);
      const amount = parseAmount(requirements.amount);
      await requestConfirmation(requirements, amount, options);

      // Confirmed (or below threshold) — let the wrapped client do the real
      // fetch → 402 → sign → retry flow. This repeats the 402 round-trip;
      // see the module doc comment and README for why.
      return client.fetch(url, init);
    },
  };
}
