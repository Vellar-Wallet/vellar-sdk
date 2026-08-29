// Library surface, for embedding the payer in another host or testing it.
// The runnable server is ./bin.ts (`vellar-mcp-x402-payer`).

export {
  checkReadiness,
  type ReadinessEnv,
  type ReadinessIssue,
  type ReadinessIssueCode,
  type ReadinessResult,
} from "./readiness.js";

export { loadConfig, type PayerConfig, type PayerNetwork } from "./config.js";
export * from "./errors.js";
export { createMutex, createSpendLedger, type SpendLedger, type SpendSnapshot } from "./ledger.js";
export {
  clearRegisteredSecrets,
  formatError,
  log,
  redact,
  registerSecret,
  renderUntrusted,
  truncateUtf8,
  type LogLevel,
  type Truncated,
} from "./output.js";
export {
  createPayer,
  type FetchLike,
  type PayResult,
  type Payer,
  type PayerDeps,
  type QuoteResult,
  type QuotedOption,
  type ResourceContent,
} from "./payer.js";
export {
  assertV2Challenge,
  narrowTo,
  toGuardView,
  type X402Challenge,
  type X402Requirement,
  type X402ResourceInfo,
} from "./protocol.js";
export { createMcpServer, startStdio, type ServerDeps } from "./server.js";
export { createOfficialSigner, createSmartAccountSigner, type PaymentSigner } from "./signer.js";
export { createSmartAccountScheme, SmartAccountAuthError, type SchemeClientLike } from "./smart-account-scheme.js";
