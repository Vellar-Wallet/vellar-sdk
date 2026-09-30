import { defineConfig } from "vitest/config";

// Opt-in only. The root vitest.config.ts excludes every *.integration.test.ts
// file in the repo by design — the hermetic default suite must never touch
// the network — so this test needs its own config to run at all. Set
// VELLAR_LIVE_X402_SECRET and VELLAR_LIVE_X402_TEST_ASSET first (see
// README.md), then:
//
//   npx vitest run --config contrib/pubnet-honesty-proofs-security-e2e/vitest.config.ts
export default defineConfig({
  test: {
    include: ["contrib/pubnet-honesty-proofs-security-e2e/*.integration.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
