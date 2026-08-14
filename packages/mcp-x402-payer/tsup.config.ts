import { defineConfig } from "tsup";

// Node-only build. This package is deliberately NOT part of vellar-sdk's
// browser-safe surface: it opens stdio, reads process.env, and touches the
// filesystem. Keeping it a separate workspace package is what stops those
// dependencies leaking into the SDK's install.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    bin: "src/bin.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@stellar/stellar-sdk", "@x402/core", "@x402/stellar", "@modelcontextprotocol/sdk", "vellar-sdk", "zod"],
});
