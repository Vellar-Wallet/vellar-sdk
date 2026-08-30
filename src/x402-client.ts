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

export function createX402Client(deps: X402ClientDeps): X402Client {
  // Fail here, with the actionable error, not inside rpc.Server's URL parse.
  assertValidX402RpcUrl(deps.rpcUrl);
  const server = new rpc.Server(deps.rpcUrl);
  const doFetch: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  // A hard ceiling on the derived expiration offset (undefined ⇒ no ceiling).
  const expirationCeiling = deps.expirationLedgerOffset;
  const ourCaip2 = CAIP2_BY_NETWORK[deps.network];

  async function buildSignedPayment(
    requirements: PaymentRequirements,
  ): Promise<{ header: string; amount: bigint }> {
    const net = NETWORKS[requirements.network];
    if (!net) throw new NoUsablePaymentOptionError(`Unknown network ${requirements.network}`);

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

    let first: Response;
    let timedOut = false;

    if (init.timeoutMs !== undefined && init.timeoutMs > 0) {
      const controller = new AbortController();
      const signal = controller.signal;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, init.timeoutMs);

      const callerSignal = init.requestInit?.signal;
      if (callerSignal) {
        if (callerSignal.aborted) {
          controller.abort();
        } else {
          callerSignal.addEventListener("abort", () => controller.abort());
        }
      }

      try {
        first = await doFetch(url, { ...baseInit, signal });
      } catch (err: any) {
        if (timedOut || err.name === "AbortError") {
          const fallbackRes = init.fallbackResponse ?? new Response(
            JSON.stringify({ error: "Discovery timed out", partial: true }),
            {
              status: 504,
              statusText: "Gateway Timeout",
              headers: { "Content-Type": "application/json" },
            }
          );
          return {
            response: fallbackRes,
            paid: false,
            isFallback: true,
          };
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    } else {
      first = await doFetch(url, baseInit);
    }

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
      throw new PaymentRejectedError(
        `x402 payment was not accepted (HTTP ${paid.status}${reason ? `: ${reason}` : ""}). ` +
          `If this was over-budget, the on-chain policy rejected it at facilitator verify.`,
        reason,
      );
    }

    const settlement = readSettlement(paid, requirements, amount, deps.network);
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
