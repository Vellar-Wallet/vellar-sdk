/**
 * Reference implementation for a single typed client error shape.
 *
 * Contributed for issue #211: standardize error shape returned across
 * client.ts public methods.
 *
 * In production SDK code this would live beside the wallet facade; here it is
 * self-contained so contributors can review and test without editing src/.
 */

export type ClientErrorCode = "WALLET_NOT_READY" | "POLICIES_NOT_CONFIGURED";

export type ClientErrorDetails = Record<string, unknown>;

export class VellarClientError extends Error {
  readonly code: ClientErrorCode;
  readonly details: ClientErrorDetails | undefined;

  constructor(code: ClientErrorCode, message: string, details?: ClientErrorDetails) {
    super(message);
    this.name = "VellarClientError";
    this.code = code;
    this.details = details;
  }
}

/** Stable, log-friendly string for a VellarClientError. */
export function formatClientError(error: VellarClientError): string {
  if (error.details && Object.keys(error.details).length > 0) {
    return `[${error.code}] ${error.message} — ${JSON.stringify(error.details)}`;
  }
  return `[${error.code}] ${error.message}`;
}

/** Thrown when a wallet method is called before create()/connect(). */
export class WalletNotReadyError extends VellarClientError {
  constructor(message: string, details?: ClientErrorDetails) {
    super("WALLET_NOT_READY", message, details);
    this.name = "WalletNotReadyError";
  }
}

/** Minimal wallet facade guard helpers mirroring client.ts throws. */
export function requireSession(session: unknown, method: string): asserts session is object {
  if (!session) {
    throw new WalletNotReadyError(`Call create() or connect() before ${method}()`, { method });
  }
}

export function requirePoliciesApiUrl(apiUrl: string | undefined): asserts apiUrl is string {
  if (!apiUrl) {
    throw new VellarClientError(
      "POLICIES_NOT_CONFIGURED",
      "wallet.policies requires `apiUrl` in createVellarWallet config (the policy API gateway).",
      { missing: "apiUrl" },
    );
  }
}
