// x402 client — the fetch wrapper + payment builder (smart-account path).
//
// Flow (proven in scripts/x402-spike/): request → 402 → decode requirements →
// build SEP-41 transfer(from=C-address, to=payTo, amount) → sign the wallet auth
// entry as V1 (via the injected signer) → retry with the `PAYMENT-SIGNATURE`
// header → return the unlocked response + on-chain settlement.
//
// The PURE decision layer (decode / select / validate) lives in ./x402-guards so
// payers that don't share this signing path can reuse it — see that file. It is
// re-exported here so this module's public API is unchanged.
//
// Structural deps (rpc, an AssembledTransaction builder, fetch) keep this
// unit-testable without a network. The signer is injected (ed25519 or passkey).

import { Address, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { assertAuthEntryInvocation, type ExpectedInvocation } from "./x402-auth-entry";
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
  NETWORKS,
  decodePaymentRequired,
  decodeSettlementHeader,
  extractRejectionReason,
  parseAmount,
  selectRequirements,
  utf8ToBase64,
} from "./x402-guards";
import {
  assertValidX402RpcUrl,
  CatalogEntryUnverifiableError,
  DisallowedAssetError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  PaymentRejectedError,
  classifyCatalogEntryUrl,
  type CatalogEntryUnverifiableReason,
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

/**
 * The facilitator's default `MAX_TX_FEE_STROOPS` ceiling (500,000 stroops),
 * per website/content/docs/reference/fees.md. Used only as a fallback when the
 * facilitator's error response does not report the actual ceiling.
 */
export const DEFAULT_MAX_TX_FEE_STROOPS = 500_000;

/**
 * Typed error for the facilitator's `fee_exceeds_maximum` rejection: the
 * payment bid's transaction fee exceeded the facilitator's configured
 * `MAX_TX_FEE_STROOPS`. Surfaced distinctly from a generic settlement failure
 * so a caller can programmatically suggest raising `MAX_TX_FEE_STROOPS` (a
 * policy-governed payment may legitimately need a higher ceiling).
 *
 * `ceilingStroops` carries the facilitator-reported ceiling when the error
 * response includes it; otherwise it is `undefined` (the caller can fall back
 * to {@link DEFAULT_MAX_TX_FEE_STROOPS}).
 */
export class FeeExceedsMaximumError extends Error {
  readonly ceilingStroops?: number;
  /** The raw rejection reason/code from the facilitator, when present. */
  readonly reason?: string;

  constructor(ceilingStroops?: number, reason?: string) {
    const ceilingText =
      ceilingStroops !== undefined
        ? `the facilitator's MAX_TX_FEE_STROOPS ceiling of ${ceilingStroops} stroops`
        : `the facilitator's MAX_TX_FEE_STROOPS ceiling`;
    super(
      `x402 payment bid exceeded ${ceilingText}. ` +
        `This is a policy-governed limit, not a settlement failure: raise ` +
        `MAX_TX_FEE_STROOPS on the facilitator if this payment legitimately needs a higher fee.`,
    );
    this.name = "FeeExceedsMaximumError";
    this.ceilingStroops = ceilingStroops;
    this.reason = reason;
  }
}

/** The facilitator error code this module recognises for the fee ceiling. */
export const FEE_EXCEEDS_MAXIMUM_CODE = "fee_exceeds_maximum";

/**
 * Detect the `fee_exceeds_maximum` condition in a facilitator error response
 * and extract the reported ceiling (in stroops) when present.
 *
 * Returns `undefined` when the response is not a fee-ceiling rejection. The
 * ceiling is read from any of the shapes the facilitator may use:
 * `{ code, maxTxFeeStroops }`, `{ code, ceilingStroops }`, `{ code, maxFee }`,
 * or a numeric value embedded in the reason string.
 */
export function parseFeeExceedsMaximum(
  body: unknown,
): { ceilingStroops?: number } | undefined {
  if (body === null || body === undefined) return undefined;

  let code: string | undefined;
  let reason: string | undefined;
  let ceiling: number | undefined;

  if (typeof body === "string") {
    reason = body;
  } else if (typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const rawCode = obj.code ?? obj.error;
    if (typeof rawCode === "string") code = rawCode;
    if (typeof obj.reason === "string") reason = obj.reason;
    if (typeof obj.message === "string" && reason === undefined) reason = obj.message;
    for (const key of ["maxTxFeeStroops", "ceilingStroops", "maxFee", "max_fee"]) {
      const v = obj[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        ceiling = v;
        break;
      }
      if (typeof v === "string" && /^\d+$/.test(v)) {
        ceiling = Number(v);
        break;
      }
    }
  }

  const haystack = `${code ?? ""} ${reason ?? ""}`;
  if (!haystack.includes(FEE_EXCEEDS_MAXIMUM_CODE)) return undefined;

  if (ceiling === undefined && reason) {
    // e.g. "... exceeds MAX_TX_FEE_STROOPS (500000)" or "max 500000 stroops".
    const m = reason.match(/(\d{1,15})\s*stroops?/i) ?? reason.match(/\((\d{1,15})\)/);
    if (m) ceiling = Number(m[1]);
  }

  return ceiling !== undefined ? { ceilingStroops: ceiling } : {};
}

// ---------------------------------------------------------------------------
// Discovery fallback (#821): verified_only_unavailable → ownerVerified filter
// ---------------------------------------------------------------------------

/** The facilitator error code for an unavailable server-side verified filter. */
export const VERIFIED_ONLY_UNAVAILABLE_CODE = "verified_only_unavailable";

/** A single discovery result. `ownerVerified` is the field the fallback filters on. */
export interface DiscoveryResult {
  ownerVerified?: boolean;
  [key: string]: unknown;
}

/** A discovery query. `verified_only` is the server-side filter the fallback drops. */
export interface DiscoveryQuery {
  verified_only?: boolean;
  [key: string]: unknown;
}

/** The minimal discovery surface the fallback helper needs. */
export interface DiscoveryClientLike {
  discover(query: DiscoveryQuery): Promise<DiscoveryResult[]>;
}

export interface DiscoverWithVerifiedFallbackOptions {
  /**
   * Opt in to the automatic fallback: on `verified_only_unavailable`, retry the
   * same query WITHOUT the `verified_only` filter and filter results
   * client-side on `ownerVerified`. When false/omitted the error is surfaced
   * directly to the caller.
   */
  fallbackToOwnerVerified?: boolean;
}

/** True when `err` is the facilitator's `verified_only_unavailable` error. */
export function isVerifiedOnlyUnavailable(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  const text =
    typeof err === "string"
      ? err
      : `${(err as { code?: unknown }).code ?? ""} ${
          (err as { message?: unknown }).message ?? ""
        } ${(err as { reason?: unknown }).reason ?? ""}`;
  return text.includes(VERIFIED_ONLY_UNAVAILABLE_CODE);
}

/**
 * Run a discovery query, optionally falling back to client-side
 * `ownerVerified` filtering when the server-side `verified_only` filter is
 * unavailable (#821).
 *
 * With `fallbackToOwnerVerified` set, a `verified_only_unavailable` error
 * triggers a retry of the SAME query minus `verified_only`, then filters the
 * results on `ownerVerified === true` — producing the same effective result as
 * the server-side filter would have. Without the flag, the error is rethrown.
 */
export async function discoverWithVerifiedFallback(
  client: DiscoveryClientLike,
  query: DiscoveryQuery,
  options: DiscoverWithVerifiedFallbackOptions = {},
): Promise<DiscoveryResult[]> {
  try {
    return await client.discover(query);
  } catch (err) {
    if (!options.fallbackToOwnerVerified || !isVerifiedOnlyUnavailable(err)) {
      throw err;
    }
    const { verified_only: _drop, ...unfiltered } = query;
    const results = await client.discover(unfiltered);
    return results.filter((r) => r.ownerVerified === true);
  }
}

// ---------------------------------------------------------------------------
// CAP-15 structural-conditions helper (#822 / #823)
// ---------------------------------------------------------------------------

/**
 * The four structural conditions the explorer v2 classifier checks before it
 * will classify a transaction as an x402 payment. Mirrors the heuristic
 * documented in website/content/docs/reference/explorer.md.
 */
export interface X402StructuralConditions {
  /** 1. The transaction carries exactly one Soroban operation. */
  singleSorobanOperation: boolean;
  /** 2. The operation is an `invokeHostFunction` (a Soroban invocation). */
  invokeHostFunction: boolean;
  /** 3. The operation has at least one address-credentialed auth entry. */
  hasAddressAuthEntry: boolean;
  /**
   * 4. The authorizer is NOT the operation source, the transaction source, nor
   * the fee-bump fee source (CAP-15 fee-bump structural condition).
   */
  authorizerDistinctFromSources: boolean;
}

export interface X402StructuralCheckResult {
  /** Per-condition pass/fail, itemized. */
  conditions: X402StructuralConditions;
  /** Overall: true only when all four conditions pass. */
  isX402Shape: boolean;
  /** True when the envelope is wrapped in a CAP-15 fee-bump transaction. */
  isFeeBump: boolean;
}

/** A minimal, structural view of a transaction envelope (built or submitted). */
export interface TransactionEnvelopeShape {
  /** The transaction source account (G-address). */
  source?: string;
  /** The fee-bump fee source, when the envelope is a fee-bump wrapper. */
  feeBumpSource?: string;
  /** True when the envelope is a CAP-15 fee-bump transaction. */
  feeBump?: boolean;
  operations?: Array<{
    /** The operation source account, when set (defaults to the tx source). */
    source?: string;
    /** The operation type, e.g. "invokeHostFunction". */
    type?: string;
    /** Address-credentialed auth entries: their authorizer addresses. */
    authAuthorizers?: string[];
  }>;
}

/**
 * Evaluate a built or submitted transaction envelope against the four
 * documented CAP-15 structural conditions (#822). Returns an itemized result
 * rather than a bare boolean so a caller can see which condition failed.
 *
 * This mirrors the explorer v2 classification heuristic — see
 * website/content/docs/reference/explorer.md.
 */
export function checkX402StructuralConditions(
  envelope: TransactionEnvelopeShape,
): X402StructuralCheckResult {
  const ops = envelope.operations ?? [];
  const isFeeBump = envelope.feeBump === true || envelope.feeBumpSource !== undefined;

  const singleSorobanOperation = ops.length === 1;
  const op = ops[0];
  const invokeHostFunction = op?.type === "invokeHostFunction";

  const authorizers = op?.authAuthorizers ?? [];
  const hasAddressAuthEntry = authorizers.length > 0;

  const opSource = op?.source ?? envelope.source;
  const txSource = envelope.source;
  const feeSource = envelope.feeBumpSource;
  const authorizerDistinctFromSources =
    hasAddressAuthEntry &&
    authorizers.every(
      (a) => a !== opSource && a !== txSource && (feeSource === undefined || a !== feeSource),
    );

  const conditions: X402StructuralConditions = {
    singleSorobanOperation,
    invokeHostFunction,
    hasAddressAuthEntry,
    authorizerDistinctFromSources,
  };

  const isX402Shape =
    conditions.singleSorobanOperation &&
    conditions.invokeHostFunction &&
    conditions.hasAddressAuthEntry &&
    conditions.authorizerDistinctFromSources;

  return { conditions, isX402Shape, isFeeBump };
}

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

// Estimated ledger close time (seconds). The facilitator fetches its own estimate
// from Horizon (~5s on testnet/pubnet); we use the same constant so our derived
// expiration tracks its `maxLedger = current + ceil(maxTimeoutSeconds / ~5)`.
const ESTIMATED_LEDGER_SECONDS = 5;
// Ledgers we stay UNDER the facilitator's computed maxLedger, to absorb drift
// between our getLatestLedger() read and the facilitator's (it reads a beat
// later, so ITS current ledger is ≥ ours; a margin keeps us inside its window
// even though it grants a +2 tolerance).
const EXPIRATION_SAFETY_MARGIN = 2;
// Never sign an expiration less than this many ledgers out, even for a tiny
// server timeout — below this the payment can't realistically round-trip.
const MIN_EXPIRATION_LEDGERS = 3;
/**
 * Default ceiling on seller-requested signature lifetime (security audit V-7).
 * `maxTimeoutSeconds` is attacker-controlled and previously had no upper bound
 * here unless a caller passed `expirationLedgerOffset`. 300s / 5s = 60 ledgers,
 * less the safety margin. See the scheme client for the measurement behind 300s.
 */
const DEFAULT_MAX_EXPIRATION_LEDGERS = 58;

/**
 * Ledgers-from-now to set as the signature expiration. Derived from the server's
 * `maxTimeoutSeconds` so we stay inside the facilitator's own `maxLedger` window
 * (a fixed offset would exceed a short server timeout and be rejected as
 * `expiration_too_far`). Kept a safety margin below the facilitator's ceiling,
 * floored at MIN_EXPIRATION_LEDGERS, and optionally capped by `ceiling`.
 *
 * Exported for testing; the ceiling is the client's `expirationLedgerOffset`.
 */
export function expirationOffsetFor(
  maxTimeoutSeconds: number | undefined,
  ceiling?: number,
): number {
  const windowLedgers = Math.ceil((maxTimeoutSeconds ?? 120) / ESTIMATED_LEDGER_SECONDS);
  let offset = windowLedgers - EXPIRATION_SAFETY_MARGIN;
  // An explicit ceiling still wins; absent one, fall back to the default bound
  // rather than honouring whatever the seller asked for.
  offset = Math.min(offset, ceiling ?? DEFAULT_MAX_EXPIRATION_LEDGERS);
  return Math.max(offset, MIN_EXPIRATION_LEDGERS);
}

/**
 * Assert that a discovered resource URL is structurally verifiable. Throws the
 * typed `CatalogEntryUnverifiableError` when the URL matches one of the three
 * documented triggers (http scheme, loopback host, route template) — see
 * website/content/docs/operators/limits.md (`unverifiableEntries`) and
 * website/content/docs/concepts/bazaar-and-discovery.md.
 *
 * Exported so discovery callers can classify a resource before handing it to
 * the client, and so tests can exercise the triggers directly.
 */
export function assertCatalogEntryVerifiable(url: string): void {
  const reason: CatalogEntryUnverifiableReason | undefined = classifyCatalogEntryUrl(url);
  if (reason) throw new CatalogEntryUnverifiableError(url, reason);
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

  async function buildSignedPayment(
    requirements: PaymentRequirements,
  ): Promise<{ header: string; amount: bigint }> {
    const net = NETWORKS[requirements.network];
    if (!net) throw new NoUsablePaymentOptionError(`Unknown network ${requirements.network}`);

    // Attribute-scoped budget check (#225) — BEFORE simulation, so an
    // out-of-budget payment never even round-trips to the RPC. Independent of
    // (checked in addition to) maxAmount / allowedAssets in createPayment.
    const budgetRequest = budgetRequestFor(requirements);
    await assertBudgetAttributes(budgetAttributes, budgetRequest, deps.budgetAttributeTracker);

    // Build the SEP-41 transfer(from = C-address, to = payTo, amount).
    const tx = await AssembledTransaction.build({
      contractId: requirements.asset,
      method: "transfer",
      args: [
        nativeToScVal(deps.signer.address, { type: "address" }),
        nativeToScVal(requirements.payTo, { type: "address" }),
        nativeToScVal(parseAmount(requirements.amount), { type: "i128" }),
      ],
      networkPassphrase: net.passphrase,
      rpcUrl: deps.rpcUrl,
      publicKey: deps.simulationSourceAccount,
      parseResultXdr: (r: unknown) => r,
    });

    const latest = await server.getLatestLedger();
    const expirationLedger =
      latest.sequence + expirationOffsetFor(requirements.maxTimeoutSeconds, expirationCeiling);

    if (!tx.built) {
      throw new Error(
        "x402: failed to build the transfer transaction (simulation returned nothing).",
      );
    }
    const built = tx.built;

    // What we intend to authorise. `built` came back from the RPC's simulation,
    // so its auth entries are untrusted input until compared against this.
    const expected: ExpectedInvocation = {
      contract: requirements.asset,
      functionName: "transfer",
      from: deps.signer.address,
      to: requirements.payTo,
      amount: parseAmount(requirements.amount),
    };

    // Sign every wallet auth entry (V1) via the injected signer.
    const op = built.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
    const auth = op.auth ?? [];
    let signed = 0;
    for (let i = 0; i < auth.length; i++) {
      const entry = auth[i]!;
      if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
      const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
      if (addr !== deps.signer.address) continue;

      // Security audit V-1. The credential address only establishes that the
      // entry is ours to sign; this establishes WHAT it does. Predates the
      // smart-account work — the classic path has always had this gap.
      assertAuthEntryInvocation(entry, expected);

      const signedXdr = await deps.signer.signAuthEntry(entry.toXDR("base64"), {
        networkPassphrase: net.passphrase,
        expirationLedger,
      });
      auth[i] = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
      signed++;
    }
    if (signed === 0) {
      throw new Error("No wallet auth entry found to sign for the payer address.");
    }
    op.auth = auth;

    // The SDK submits a PLAIN transaction — never a CAP-15 fee-bump wrapper.
    // The explorer v1 classifier required a fee-bump wrapper and so missed
    // Vellar settlements entirely; v2 covers this plain shape. See
    // website/content/docs/architecture/settlement-path.md.
    const payload = {
      x402Version: 2,
      accepted: requirements,
      payload: { transaction: built.toXDR() },
    };
    return {
      header: utf8ToBase64(JSON.stringify(payload)),
      amount: parseAmount(requirements.amount),
    };
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
    const { header, amount } = await buildSignedPayment(requirements);
    return { header, requirements, amount };
  }

  async function x402Fetch(url: string, init: X402FetchInit): Promise<X402Response> {
    // A discovered resource whose URL can structurally never be verified (http
    // scheme, loopback host, or a route template) is a permanent condition, not
    // a transient payment failure — surface the typed classification up front
    // rather than paying for a resource the facilitator can never verify.
    assertCatalogEntryVerifiable(url);

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
    const { header, amount } = await buildSignedPayment(requirements);

    const paid = await doFetch(url, {
      ...baseInit,
      headers: { ...(init.headers ?? {}), "PAYMENT-SIGNATURE": header },
    });

    if (paid.status === 402 || paid.status >= 400) {
      const reason = extractRejectionReason(paid);
      // Surface the facilitator's fee ceiling distinctly from a generic
      // settlement failure so the caller can suggest raising MAX_TX_FEE_STROOPS.
      const feeCeiling = parseFeeExceedsMaximum(reason);
      if (feeCeiling) {
        throw new FeeExceedsMaximumError(feeCeiling.ceilingStroops, reason);
      }
      throw new PaymentRejectedError(
        `x402 payment was not accepted (HTTP ${paid.status}${reason ? `: ${reason}` : ""}). ` +
          `If this was over-budget, the on-chain policy rejected it at facilitator verify.`,
        reason,
      );
    }

    const settlement = readSettlement(paid, requirements, amount, deps.network);

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

function readSettlement(
  res: Response,
  requirements: PaymentRequirements,
  amount: bigint,
  network: Network,
): X402Response["settlement"] {
  const decoded = decodeSettlementHeader(res);
  if (!decoded) return undefined;
  return {
    transaction: decoded.transaction,
    payer: decoded.payer ?? requirements.payTo,
    asset: requirements.asset,
    amount,
    network,
  };
}
