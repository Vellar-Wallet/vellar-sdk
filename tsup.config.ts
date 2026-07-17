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
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@stellar/stellar-sdk", "zustand"],
});
