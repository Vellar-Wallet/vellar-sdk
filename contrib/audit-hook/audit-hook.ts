// Audit hook for x402 signer actions (#262).
//
// Defines the list of signer actions requiring an audit hook and provides
// an onSignerAction hook invoked with actor context and outcome, so a host
// can ship a tamper-evident audit trail of who authorized (or was denied)
// which payment.
//
// This module is intentionally self-contained (only type-only imports from
// `../../src/`) so it can be used by consumers without editing files outside
// `contrib/`. The SDK's `x402-signer.ts` already exports the same types;
// this contrib version is a standalone reference that consumers can import
// directly or use as a pattern to implement their own hook.
//
// ## Exported types
//
// - `X402SignerAction` — the complete set of signer actions that warrant an
//   audit hook: `"authorize"` | `"deny"`.
// - `X402SignerActionEvent` — the payload passed to the hook for every signer
//   action, containing: action, actor, outcome, networkPassphrase, and
//   optional error.
// - `X402SignerActionHook` — a consumer-supplied audit sink invoked for every
//   signer action: `(event: X402SignerActionEvent) => void | Promise<void>`.
//
// ## How it works in the SDK
//
// The SDK's `createSessionKeySigner` and `createPasskeyX402Signer` both accept
// an `onSignerAction` config option of type `X402SignerActionHook`. When a
// signer action completes (successfully or with error), the hook is invoked
// with an `X402SignerActionEvent`.
//
// ## Example usage
//
// ```ts
// import { X402SignerActionHook, type X402SignerActionEvent } from
//   "vellar-sdk/contrib/audit-hook";
//
// const auditLog: X402SignerActionHook = async (event) => {
//   // Append to an append-only log, send to a monitoring service, etc.
//   console.log(`Signer action: ${event.action}, outcome: ${event.outcome}, actor: ${event.actor}`);
// };
//
// const signer = createSessionKeySigner({
//   address: "CAAA...",
//   secretKey: "secret...",
//   onSignerAction: auditLog,
// });