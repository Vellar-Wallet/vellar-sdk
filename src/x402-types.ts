// x402 client — domain types (no network / no stellar-sdk imports here).
//
// x402 is the HTTP-402 payment protocol: a resource server answers an unpaid
// request with 402 + payment requirements; the client builds a signed payment
// and retries. On Stellar, a hosted facilitator verifies + settles a SEP-41
// transfer authorized by a Soroban auth entry. Vellar pays as a smart account
// (C-address) whose ed25519 session key (or passkey) signs a V1 auth entry —
// with an on-chain spending-limit policy enforcing the budget at __check_auth
// time. See docs/design-x402-sdk-client.md and technical-doc.md §17.

import type { Network } from "./types";

/**
 * Payment requirements for one accepted payment option, as carried in a 402
 * response's `PAYMENT-REQUIRED` header (x402 v2). Amounts are the token's base
 * units, as a decimal string (i128 range preserved).
 */
export interface PaymentRequirements {
  scheme: string; // "exact"
  network: string; // CAIP-2, e.g. "stellar:testnet"
  /** The SEP-41 token contract (SAC) the payment must be made in. */
  asset: string;
  /** Amount to pay, in the asset's base units, as a decimal string. */
  amount: string;
  /** Recipient (the resource server's payee). */
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

/**
 * The decoded x402 payment challenge (the 402 body / `PAYMENT-REQUIRED` header).
 */
export interface PaymentRequired {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirements[];
  resource?: { url: string; description?: string; mimeType?: string };
}

/**
 * A Vellar smart-account x402 signer. Produces V1 (`sorobanCredentialsAddress`)
 * auth-entry signatures that a Vellar wallet's `__check_auth` accepts — i.e. the
 * smart-wallet signature map, NOT a classic `{public_key, signature}` credential.
 * Structural: callers may supply their own; the SDK ships `createSessionKeySigner`
 * (agent) and `createPasskeyX402Signer` (human).
 */
export interface SmartAccountX402Signer {
  /** The C-address that pays — the auth-entry credential address. */
  readonly address: string;
  /**
   * Sign one V1 auth entry for `address`, returning the signed entry (base64
   * XDR of `xdr.SorobanAuthorizationEntry`). Sets the signature-expiration
   * ledger and produces the smart-wallet signature map, keeping V1 credentials.
   */
  signAuthEntry(
    entryXdr: string,
    opts: { networkPassphrase: string; expirationLedger: number },
  ): Promise<string>;
}

/** Options for building/signing a single payment (shared by fetch + createPayment). */
export interface X402PayOptions {
  /**
   * Hard ceiling in the asset's base units. The client refuses to SIGN a payment
   * whose required amount exceeds this. NOTE: a client-side guard against an
   * over-charging server — NOT the budget. The durable budget is the on-chain
   * spending-limit policy attached to the signing key.
   */
  maxAmount: bigint;
  /** If set, only pay for these asset (SAC) ids; a 402 asking for anything else
   * is rejected without signing. Default: accept whatever asset the server asks. */
  allowedAssets?: string[];
}

export interface X402FetchInit extends X402PayOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  /** Passed through to the underlying fetch (signal, credentials, …). */
  requestInit?: Omit<RequestInit, "method" | "headers" | "body">;
}

/** A signed, ready-to-send payment payload (the `PAYMENT-SIGNATURE` header value). */
export interface SignedPayment {
  /** Base64 value for the `PAYMENT-SIGNATURE` request header. */
  header: string;
  /** The requirements this payment satisfies. */
  requirements: PaymentRequirements;
  /** Amount that will be paid (base units). */
  amount: bigint;
}

/** Settlement details, present when a payment was actually made. */
export interface X402Settlement {
  /** On-chain settlement transaction hash. */
  transaction: string;
  /** The payer C-address. */
  payer: string;
  asset: string;
  amount: bigint;
  network: Network;
}

export interface X402Response {
  /** The unlocked resource response (2xx), or the original if no payment was needed. */
  response: Response;
  /** True when a payment was made to unlock the resource. */
  paid: boolean;
  /** Present when `paid` — the on-chain settlement. */
  settlement?: X402Settlement;
}

/** The public x402 facade on the wallet handle. */
export interface X402Client {
  /**
   * Fetch a resource, transparently paying an x402 (HTTP 402) challenge. On 402:
   * decode requirements → build + sign the SEP-41 transfer as a V1 auth entry →
   * retry with the `PAYMENT-SIGNATURE` header → return the unlocked response +
   * settlement. Never pays above `init.maxAmount`.
   */
  fetch(url: string, init: X402FetchInit): Promise<X402Response>;
  /**
   * Lower-level: sign a payment for already-decoded requirements without sending
   * it. For callers managing their own transport.
   */
  createPayment(
    requirements: PaymentRequirements,
    opts: X402PayOptions,
  ): Promise<SignedPayment>;
}

// ── errors ───────────────────────────────────────────────────────────────────

/** `wallet.x402` used without x402 config in `createVellarWallet`. */
export class X402NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402NotConfiguredError";
  }
}

/**
 * Guard: x402 needs a parseable RPC URL. Without this, an empty or malformed
 * `rpcUrl` slipped through construction and only failed later, deep inside
 * `@stellar/stellar-sdk` (`new rpc.Server("")` → raw `TypeError: Invalid URL`)
 * — far from the misconfiguration that caused it. Runs at `createVellarWallet`
 * construction AND on every `createX402Client` call, so a config object
 * mutated after construction still fails with the clear error.
 */
export function assertValidX402RpcUrl(rpcUrl: string | undefined): asserts rpcUrl is string {
  let valid = false;
  if (typeof rpcUrl === "string" && rpcUrl.length > 0) {
    try {
      new URL(rpcUrl);
      valid = true;
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    const got = rpcUrl === undefined ? "undefined" : JSON.stringify(rpcUrl);
    throw new X402NotConfiguredError(
      `wallet.x402 requires a valid \`rpcUrl\` (got ${got}). Pass it as \`x402.rpcUrl\` ` +
        "(or top-level `rpcUrl`) in createVellarWallet, e.g. " +
        '"https://soroban-testnet.stellar.org" for testnet.',
    );
  }
}

/** The server asked for more than the caller's `maxAmount`. No payment was signed. */
export class MaxAmountExceededError extends Error {
  constructor(
    readonly required: bigint,
    readonly maxAmount: bigint,
    readonly asset: string,
  ) {
    super(
      `x402 payment of ${required} (${asset}) exceeds maxAmount ${maxAmount}; refusing to sign.`,
    );
    this.name = "MaxAmountExceededError";
  }
}

/** The server asked for an asset not in `allowedAssets`. No payment was signed. */
export class DisallowedAssetError extends Error {
  constructor(
    readonly asset: string,
    readonly allowedAssets: string[],
  ) {
    super(`x402 requested asset ${asset} is not in allowedAssets [${allowedAssets.join(", ")}].`);
    this.name = "DisallowedAssetError";
  }
}

/** The 402 offered no payment option this client can satisfy (network/scheme/asset). */
export class NoUsablePaymentOptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoUsablePaymentOptionError";
  }
}

/** The facilitator rejected the payment at verify time (e.g. over-budget → the
 * on-chain policy blocked it). Carries the facilitator's reason. */
export class PaymentRejectedError extends Error {
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "PaymentRejectedError";
  }
}

/** A payment requirement from the server was malformed (e.g. a non-integer or
 * negative `amount`). No payment was signed. */
export class InvalidRequirementsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequirementsError";
  }
}
