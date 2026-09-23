import { defineConfig } from "tsup";

// Node-only build, matching the mcp-x402-payer package: this CLI reads
// process.env, touches the filesystem, and writes to stdout. Runtime deps stay
// external so the published tarball is thin and the Stellar SDK is not bundled.
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
  external: ["@stellar/stellar-sdk", "@x402/core", "@x402/stellar", "commander", "vellar-sdk"],
});
