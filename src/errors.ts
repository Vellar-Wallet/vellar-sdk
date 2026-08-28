/**
 * Issue #249 — Standardized SDK Error Codes & Base Error Classes.
 *
 * All SDK modules throw errors with standardized string codes following
 * the format: `VELLAR_<MODULE>_<REASON>`.
 */

export const VellarErrorCode = {
  // Auth & Session
  AUTH_SESSION_EXPIRED: "VELLAR_AUTH_SESSION_EXPIRED",
  AUTH_BROWSER_REQUIRED: "VELLAR_AUTH_BROWSER_REQUIRED",
  AUTH_INVALID_CREDENTIALS: "VELLAR_AUTH_INVALID_CREDENTIALS",
  AUTH_CHALLENGE_REPLAYED: "VELLAR_AUTH_CHALLENGE_REPLAYED",

  // RPC & Network
  RPC_RATE_LIMIT_EXCEEDED: "VELLAR_RPC_RATE_LIMIT_EXCEEDED",
  RPC_ENDPOINT_FAILED: "VELLAR_RPC_ENDPOINT_FAILED",
  RPC_TIMEOUT: "VELLAR_RPC_TIMEOUT",
  RPC_INVALID_NETWORK: "VELLAR_RPC_INVALID_NETWORK",

  // Config & Validation
  CONFIG_INVALID: "VELLAR_CONFIG_INVALID",
  VALIDATION_INVALID_ADDRESS: "VELLAR_VALIDATION_INVALID_ADDRESS",
  VALIDATION_UNTRUSTED_VECTOR: "VELLAR_VALIDATION_UNTRUSTED_VECTOR",

  // x402 Payment & Protocol
  X402_NOT_CONFIGURED: "VELLAR_X402_NOT_CONFIGURED",
  X402_PAYMENT_REJECTED: "VELLAR_X402_PAYMENT_REJECTED",
  X402_INVALID_CHALLENGE: "VELLAR_X402_INVALID_CHALLENGE",
  X402_SIGNER_UNAUTHORIZED: "VELLAR_X402_SIGNER_UNAUTHORIZED",
} as const;

export type VellarErrorCodeType = (typeof VellarErrorCode)[keyof typeof VellarErrorCode];

export class VellarError extends Error {
  public readonly code: VellarErrorCodeType;
  public readonly details?: Record<string, unknown>;

  constructor(code: VellarErrorCodeType, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.name = "VellarError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
