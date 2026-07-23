// vellar-sdk — passkey smart-wallet SDK for Stellar.
//
// Public entry point: `createVellarWallet(config)` (see ./client). The lower-level
// building blocks below remain exported for advanced integrators who want to
// compose their own flows.
//
// (balances-rpc is intentionally NOT re-exported here — import it from
// "vellar-sdk/rpc" so stellar-sdk stays out of bundles that don't need it)
export * from "./types";
export * from "./client";
export * from "./config";
export * from "./http-backend";
export * from "./balances";
export * from "./connector";
export * from "./passkeykit-connector";
export * from "./payments";
export * from "./payments-client";
export * from "./policy-types";
export * from "./policy-client";
export * from "./policy-facade";
export * from "./session";
export * from "./tx-status";
