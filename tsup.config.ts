import { defineConfig } from "tsup";

// Build the SDK to dist/ as ESM + CJS with type declarations. Three entry
// points mirror the package `exports`: the main facade, the balances helpers,
// and the RPC-backed readers (kept separate so @stellar/stellar-sdk stays out
// of bundles that don't read balances).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    balances: "src/balances.ts",
    rpc: "src/rpc.ts",
    // The pure x402 decision layer, published separately so payers that don't
    // share the smart-account signing path (e.g. the MCP payer) can import the
    // guards without pulling in the wallet plumbing.
    "x402-guards": "src/x402-guards.ts",
    // The untrusted-data fence + its conformance vectors. Shared with the
    // facilitator so one format has one implementation.
    "x402-untrusted": "src/x402-untrusted.ts",
    "x402-untrusted-vectors": "src/x402-untrusted-vectors.ts",
    // Signed-request auth between the SDK and a vellar-facilitator deployment.
    // Dependency-free, like the guards/untrusted modules, so a payer that
    // doesn't share the wallet plumbing can sign facilitator requests alone.
    "x402-request-auth": "src/x402-request-auth.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@stellar/stellar-sdk", "zustand"],
});
