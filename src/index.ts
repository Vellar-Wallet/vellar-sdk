// vellar-sdk — passkey smart-wallet SDK for Stellar.
//
// Public entry point: `createVellarWallet(config)` (see ./client). The lower-level
// building blocks below remain exported for advanced integrators who want to
// compose their own flows.
//
// (balances-rpc is intentionally NOT re-exported here — import it from
// "vellar-sdk/rpc" so stellar-sdk stays out of bundles that don't need it)

/** Stable v1 API — breaking changes only in major semver releases. */
export * from "./v1-exports";

/** Experimental API — may change in any release. Prefer this namespace for new code. */
export * as experimental from "./experimental-exports";

// Legacy flat re-exports of experimental symbols (same stability as experimental.*).
export * from "./experimental-exports";
