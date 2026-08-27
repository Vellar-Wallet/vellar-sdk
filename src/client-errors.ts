// Typed errors for the public wallet client facade (client.ts). Every throw from
// the facade uses VellarClientError so consumers can branch on `code` and read
// optional structured `details` without parsing message strings.

export type VellarClientErrorCode = "WALLET_NOT_READY" | "POLICIES_NOT_CONFIGURED";

export type VellarClientErrorDetails = Record<string, unknown>;

export class VellarClientError extends Error {
  readonly code: VellarClientErrorCode;
  readonly details: VellarClientErrorDetails | undefined;

  constructor(
    code: VellarClientErrorCode,
    message: string,
    details?: VellarClientErrorDetails,
  ) {
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
  constructor(message: string, details?: VellarClientErrorDetails) {
    super("WALLET_NOT_READY", message, details);
    this.name = "WalletNotReadyError";
  }
}
