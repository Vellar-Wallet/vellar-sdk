// Shared error catalog (idea.md issue S2): every error the SDK throws across
// its public surface extends this so callers have one catchable ancestor —
// `catch (e) { if (e instanceof VellarError) ... }` — plus a specific
// subclass to branch on without string-matching `error.message`. Domain-
// specific error classes live next to the code that throws them (e.g.
// `WalletApiError` in http-backend.ts, `PolicyApiError` in policy-types.ts);
// this file only holds the base class and the classes with no single better
// home.

export class VellarError extends Error {}

/** A direct Soroban RPC call (balance read, transaction status) failed or
 * returned an unusable result. Thrown by the `vellar-sdk/rpc` readers. */
export class RpcRequestError extends VellarError {
  constructor(message: string) {
    super(message);
    this.name = "RpcRequestError";
  }
}

/** The SDK could not convert a signed transaction to XDR (e.g. `kit.sign()`
 * returned something `signedToXdr` doesn't recognize). */
export class SignedTransactionError extends VellarError {
  constructor(message: string) {
    super(message);
    this.name = "SignedTransactionError";
  }
}

/** An x402 payment could not be built or sent — a local runtime/environment
 * failure (simulation, expired auth entry, a non-replayable request body),
 * distinct from the server-side rejections in x402-types.ts. */
export class X402PaymentError extends VellarError {
  constructor(message: string) {
    super(message);
    this.name = "X402PaymentError";
  }
}

/** An x402 signer was misconfigured or asked to sign an entry it can't (bad
 * address, wrong credential type) — a caller/config error, discoverable
 * before any network I/O. Kept distinct from `X402PaymentError` so a caller
 * can fail fast on misconfiguration vs. retry a transient build failure. */
export class X402SigningError extends X402PaymentError {
  constructor(message: string) {
    super(message);
    this.name = "X402SigningError";
  }
}
