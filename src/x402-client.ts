// x402 client — the fetch wrapper + payment orchestration (smart-account path).
//
// Flow (proven in scripts/x402-spike/): request → 402 → decode requirements →
// build SEP-41 transfer(from=C-address, to=payTo, amount) → sign the wallet auth
// entry as V1 (via the injected signer) → retry with the `PAYMENT-SIGNATURE`
// header → return the unlocked response + on-chain settlement.
//
// This module is deliberately just the orchestration layer now (#299 split it
// into two focused pieces):
//   - the PURE decision layer (decode / select / validate a 402 challenge)
//     lives in ./x402-guards, so payers that don't share this signing path can
//     reuse it — see that file. Re-exported here so this module's public API
//     is unchanged.
//   - the payment-BUILDING layer (simulate the transfer, derive the signature
//     expiration, verify + sign the auth entry) lives in ./x402-payment.
//
// What's left here: turning `X402ClientDeps` into a `rpc.Server` + signed
// fetch, running the guards/budget checks BEFORE a payment is built, wiring
// the 402 → pay → retry flow, and recording settlement/spend after the
// facilitator actually accepts a payment.
//
// Structural deps (rpc, an AssembledTransaction builder, fetch) keep this
// unit-testable without a network. The signer is injected (ed25519 or passkey).

import { rpc } from "@stellar/stellar-sdk";
import type { Network } from "./types";
import {
  createSignedFetch,
  type FacilitatorRequestSigningConfig,
} from "./x402-request-auth";
import {
  assertBudgetAttributes,
  assertValidBudgetAttributeRules,
  matchingBudgetRule,
  type BudgetAttributeRequest,
  type BudgetAttributeRule,
  type BudgetAttributeTracker,
} from "./x402-budget-attributes";
import {
  CAIP2_BY_NETWORK,
  decodePaymentRequired,
  decodeSettlementHeader,
  extractRejectionReason,
  parseAmount,
  selectRequirements,
} from "./x402-guards";
import { buildSignedPayment, readSettlement } from "./x402-payment";
import {
  assertValidX402RpcUrl,
  DisallowedAssetError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  PaymentRejectedError,
  type PaymentRequirements,
  type SignedPayment,
  type SmartAccountX402Signer,
  type X402Client,
  type X402FetchInit,
  type X402PayOptions,
  type X402Response,
} from "./x402-types";

// The pure guard layer is part of this module's published surface.
export * from "./x402-guards";
// The payment-building layer's public exports are part of this module's
// published surface too, so existing imports of `expirationOffsetFor` from
// "./x402-client" keep working unchanged.
export { expirationOffsetFor } from "./x402-payment";

/** Minimal fetch surface (injectable for tests). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface X402ClientDeps {
  signer: SmartAccountX402Signer;
  /** Soroban RPC URL for the network the wallet is on. */
  rpcUrl: string;
  /** The wallet's network (must match the facilitator's advertised network). */
  network: Network;
  /** A funded classic G-account used ONLY as the simulation tx source (the
   * facilitator rebuilds with its own source; this account is never charged and
   * signs nothing). Required because a contract can't source an envelope. */
  simulationSourceAccount: string;
  /** Injected fetch (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Signature-expiration window in ledgers (default 12 ≈ 60s at 5s ledgers). */
  expirationLedgerOffset?: number;
  /**
   * Signed-request auth between this client and the facilitator (#226).
   * When set, every outgoing facilitator request (the initial probe AND the
   * paid retry) carries the `X-Vellar-*` signature headers from
   * ./x402-request-auth, on top of whatever `fetchImpl` already does. Opt-in:
   * a facilitator that does not verify these headers is unaffected either way.
   */
  requestSigning?: FacilitatorRequestSigningConfig;
  /**
   * Attribute-based scoping for the session key's budget (#225): merchant,
   * category, and time-window rules checked BEFORE a payment is built or
   * signed, on top of (never instead of) `maxAmount` and the on-chain
   * spending-limit policy. Omit for no attribute scoping (the pre-#225
   * behaviour — only `maxAmount` and the chain enforce the budget). See
   * ./x402-budget-attributes.ts for what this does and does not guarantee.
   */
  budgetAttributes?: readonly BudgetAttributeRule[];
  /** Running-spend accounting for `budgetAttributes` rules with a
   * `periodMaxAmount`. Without it, only each rule's per-payment `maxAmount`
   * is enforced — `periodMaxAmount` is silently not tracked. */
  budgetAttributeTracker?: BudgetAttributeTracker;
  /** Clock for time-window budget rules (defaults to `() => new Date()`);
   * overridable for tests. */
  now?: () => Date;
}

export function createX402Client(deps: X402ClientDeps): X402Client {
  // Fail here, with the actionable error, not inside rpc.Server's URL parse.
  assertValidX402RpcUrl(deps.rpcUrl);
  // Fail on a malformed rule at construction, not mid-payment (#225 mirrors
  // #224's assertValidCapabilityRules posture: a typo'd rule fails loudly
  // before it can wrongly deny or wrongly admit).
  const budgetAttributes = deps.budgetAttributes ?? [];
  assertValidBudgetAttributeRules(budgetAttributes);
  const now = deps.now ?? (() => new Date());
  const server = new rpc.Server(deps.rpcUrl);
  const baseFetch: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  // Request signing wraps whatever fetch the caller already injected, so a
  // test double or logging wrapper composes with it rather than being replaced.
  const doFetch: FetchLike = deps.requestSigning
    ? createSignedFetch(deps.requestSigning, baseFetch)
    : baseFetch;
  // A hard ceiling on the derived expiration offset (undefined ⇒ no ceiling).
  const expirationCeiling = deps.expirationLedgerOffset;
  const ourCaip2 = CAIP2_BY_NETWORK[deps.network];

  function budgetRequestFor(requirements: PaymentRequirements): BudgetAttributeRequest {
    const category = requirements.extra?.category;
    return {
      merchant: requirements.payTo,
      ...(typeof category === "string" ? { category } : {}),
      amount: parseAmount(requirements.amount),
      at: now(),
    };
  }

  async function buildPaymentFor(
    requirements: PaymentRequirements,
  ): Promise<{ header: string; amount: bigint }> {
    // Attribute-scoped budget check (#225) — BEFORE simulation, so an
    // out-of-budget payment never even round-trips to the RPC. Independent of
    // (checked in addition to) maxAmount / allowedAssets in createPayment.
    const budgetRequest = budgetRequestFor(requirements);
    await assertBudgetAttributes(budgetAttributes, budgetRequest, deps.budgetAttributeTracker);

    return buildSignedPayment(requirements, {
      signer: deps.signer,
      rpcUrl: deps.rpcUrl,
      server,
      simulationSourceAccount: deps.simulationSourceAccount,
      expirationCeiling,
    });
  }

  async function createPayment(
    requirements: PaymentRequirements,
    opts: X402PayOptions,
  ): Promise<SignedPayment> {
    // Re-apply guards even on the direct path (a caller-supplied requirement is
    // still subject to maxAmount / allowedAssets).
    if (opts.allowedAssets && !opts.allowedAssets.includes(requirements.asset)) {
      throw new DisallowedAssetError(requirements.asset, opts.allowedAssets);
    }
    const required = parseAmount(requirements.amount);
    if (required > opts.maxAmount) {
      throw new MaxAmountExceededError(required, opts.maxAmount, requirements.asset);
    }
    const { header, amount } = await buildPaymentFor(requirements);
    return { header, requirements, amount };
  }

  async function x402Fetch(url: string, init: X402FetchInit): Promise<X402Response> {
    // A single-use body (a ReadableStream) is consumed by the first request and
    // cannot be replayed for the paid retry — the retry would silently send an
    // empty body. Reject it with a clear error; callers should pass a
    // replayable body (string, Uint8Array, Blob, FormData, URLSearchParams).
    if (init.body instanceof ReadableStream) {
      throw new Error(
        "x402: a ReadableStream body cannot be replayed on the payment retry. " +
          "Pass a buffered body (string, Uint8Array, Blob, FormData) instead.",
      );
    }
    const baseInit: RequestInit = {
      ...init.requestInit,
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body ?? undefined,
    };

    const first = await doFetch(url, baseInit);
    if (first.status !== 402) {
      return { response: first, paid: false };
    }

    const decoded = decodePaymentRequired(first);
    const requirements = selectRequirements(decoded, init, ourCaip2);
    const { header, amount } = await buildPaymentFor(requirements);

    const paid = await doFetch(url, {
      ...baseInit,
      headers: { ...(init.headers ?? {}), "PAYMENT-SIGNATURE": header },
    });

    if (paid.status === 402 || paid.status >= 400) {
      const reason = extractRejectionReason(paid);
      throw new PaymentRejectedError(
        `x402 payment was not accepted (HTTP ${paid.status}${reason ? `: ${reason}` : ""}). ` +
          `If this was over-budget, the on-chain policy rejected it at facilitator verify.`,
        reason,
      );
    }

    const settlement = readSettlement(
      decodeSettlementHeader(paid),
      requirements,
      amount,
      deps.network,
    );

    // Record spend only now that the facilitator has actually accepted the
    // payment — a request rejected above (over-budget on-chain, or any other
    // 4xx) must not consume period budget it never actually spent.
    if (deps.budgetAttributeTracker && budgetAttributes.length > 0) {
      const rule = matchingBudgetRule(budgetAttributes, budgetRequestFor(requirements));
      if (rule?.periodMaxAmount !== undefined) {
        await deps.budgetAttributeTracker.record(rule, amount);
      }
    }

    return { response: paid, paid: true, settlement };
  }

  return { fetch: x402Fetch, createPayment };
}
