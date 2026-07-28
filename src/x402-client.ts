// x402 client — the fetch wrapper + payment builder.
//
// Flow (proven in scripts/x402-spike/): request → 402 → decode requirements →
// build SEP-41 transfer(from=C-address, to=payTo, amount) → sign the wallet auth
// entry as V1 (via the injected signer) → retry with the `PAYMENT-SIGNATURE`
// header → return the unlocked response + on-chain settlement.
//
// Structural deps (rpc, an AssembledTransaction builder, fetch) keep this
// unit-testable without a network. The signer is injected (ed25519 or passkey).

import {
  Address,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import type { Network } from "./types";
import {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  PaymentRejectedError,
  type PaymentRequired,
  type PaymentRequirements,
  type SignedPayment,
  type SmartAccountX402Signer,
  type X402Client,
  type X402FetchInit,
  type X402PayOptions,
  type X402Response,
} from "./x402-types";
import { X402PaymentError } from "./errors";

/** Parse a requirement's `amount` (decimal string, base units) as a non-negative
 * i128. Throws a typed error rather than letting `BigInt(...)` throw a raw
 * SyntaxError on malformed server input. */
function parseAmount(amount: string): bigint {
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    throw new InvalidRequirementsError(
      `x402 requirement has a non-integer amount ${JSON.stringify(amount)}.`,
    );
  }
  return BigInt(amount);
}

// Browser-safe base64 (this package targets bundlers/browsers; no Buffer/@types/node).
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** CAIP-2 → the network passphrase + our Network label. */
const NETWORKS: Record<string, { passphrase: string; network: Network }> = {
  "stellar:testnet": {
    passphrase: "Test SDF Network ; September 2015",
    network: "testnet",
  },
  "stellar:pubnet": {
    passphrase: "Public Global Stellar Network ; September 2015",
    network: "mainnet",
  },
};

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

const CAIP2_BY_NETWORK: Record<Network, string> = {
  testnet: "stellar:testnet",
  mainnet: "stellar:pubnet",
};

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
  if (ceiling !== undefined) offset = Math.min(offset, ceiling);
  return Math.max(offset, MIN_EXPIRATION_LEDGERS);
}

/**
 * Pick the one payment option this client can satisfy, applying guards. Pure
 * (no network) — exported for direct testing. Filters by scheme/network, then
 * sponsored-fees, then allowedAssets (WHILE selecting, so a disallowed option
 * never shadows a later allowed one), then picks the cheapest allowed option and
 * enforces maxAmount.
 */
export function selectRequirements(
  decoded: PaymentRequired,
  opts: X402PayOptions,
  ourCaip2: string,
): PaymentRequirements {
  const options = decoded.accepts ?? [];
  const onNetwork = options.filter((a) => a.scheme === "exact" && a.network === ourCaip2);
  if (onNetwork.length === 0) {
    throw new NoUsablePaymentOptionError(
      `No exact/${ourCaip2} payment option offered. Server offered: ${options
        .map((a) => `${a.scheme}/${a.network}`)
        .join(", ") || "(none)"}`,
    );
  }
  // The smart-account exact flow requires sponsored fees (the facilitator
  // rebuilds + pays). Distinct message so a caller can tell this apart from a
  // wrong-network/scheme miss.
  const candidates = onNetwork.filter((a) => !(a.extra && a.extra.areFeesSponsored === false));
  if (candidates.length === 0) {
    throw new NoUsablePaymentOptionError(
      "Payment option(s) do not sponsor fees (areFeesSponsored=false); the smart-account exact flow requires sponsored fees.",
    );
  }

  const allowed = opts.allowedAssets
    ? candidates.filter((a) => opts.allowedAssets!.includes(a.asset))
    : candidates;
  if (allowed.length === 0) {
    // Every payable candidate was disallowed by allowedAssets.
    throw new DisallowedAssetError(candidates[0]!.asset, opts.allowedAssets!);
  }

  // Prefer the cheapest allowed option (avoids overpaying when a server offers
  // the same resource in multiple assets/amounts). parseAmount validates each,
  // so a malformed amount throws a typed error rather than mis-sorting.
  const usable = allowed.reduce((cheapest, a) =>
    parseAmount(a.amount) < parseAmount(cheapest.amount) ? a : cheapest,
  );

  const required = parseAmount(usable.amount);
  if (required > opts.maxAmount) {
    throw new MaxAmountExceededError(required, opts.maxAmount, usable.asset);
  }
  return usable;
}

export function createX402Client(deps: X402ClientDeps): X402Client {
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
      throw new X402PaymentError(
        "x402: failed to build the transfer transaction (simulation returned nothing).",
      );
    }
    const built = tx.built;

    // Sign every wallet auth entry (V1) via the injected signer.
    const op = built.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
    const auth = op.auth ?? [];
    let signed = 0;
    for (let i = 0; i < auth.length; i++) {
      const entry = auth[i]!;
      if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
      const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
      if (addr !== deps.signer.address) continue;
      const signedXdr = await deps.signer.signAuthEntry(entry.toXDR("base64"), {
        networkPassphrase: net.passphrase,
        expirationLedger,
      });
      auth[i] = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
      signed++;
    }
    if (signed === 0) {
      throw new X402PaymentError("No wallet auth entry found to sign for the payer address.");
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
      throw new X402PaymentError(
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

// ── 402 decode / settlement read ───────────────────────────────────────────────

/** Decode the 402's payment requirements. x402 v2 carries them in the
 * `PAYMENT-REQUIRED` header (base64 JSON); some servers also mirror them in the
 * body. Header wins. */
export function decodePaymentRequired(res: Response): PaymentRequired {
  const header =
    res.headers.get("PAYMENT-REQUIRED") ?? res.headers.get("payment-required");
  if (header) {
    try {
      return JSON.parse(base64ToUtf8(header)) as PaymentRequired;
    } catch (err) {
      throw new NoUsablePaymentOptionError(
        `Malformed PAYMENT-REQUIRED header: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw new NoUsablePaymentOptionError(
    "402 response carried no PAYMENT-REQUIRED header.",
  );
}

function extractRejectionReason(res: Response): string | undefined {
  const header =
    res.headers.get("PAYMENT-REQUIRED") ?? res.headers.get("payment-required");
  if (!header) return undefined;
  try {
    const decoded = JSON.parse(base64ToUtf8(header)) as {
      error?: string;
    };
    return decoded.error;
  } catch {
    return undefined;
  }
}

function readSettlement(
  res: Response,
  requirements: PaymentRequirements,
  amount: bigint,
  network: Network,
): X402Response["settlement"] {
  const header =
    res.headers.get("X-PAYMENT-RESPONSE") ??
    res.headers.get("PAYMENT-RESPONSE") ??
    res.headers.get("x-payment-response");
  if (!header) return undefined;
  try {
    const decoded = JSON.parse(base64ToUtf8(header)) as {
      transaction?: string;
      payer?: string;
    };
    if (!decoded.transaction) return undefined;
    return {
      transaction: decoded.transaction,
      payer: decoded.payer ?? requirements.payTo,
      asset: requirements.asset,
      amount,
      network,
    };
  } catch {
    return undefined;
  }
}
