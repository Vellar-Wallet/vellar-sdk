import { defineConfig } from "vitest/config";

// Integration tests ONLY. Run deliberately with `npm run test:integration`.
//
// These make real payments against a LOCAL facilitator and seller. They are
// never part of `npm test`, and the localhost guard in test/integration/
// local-only.ts refuses to let them touch a hosted facilitator.
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    // A single settle attempt costs several round-trips, and the settle step
    // fails benignly ~1 time in 3, so retries are the normal path.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Payments share one ledger and one key — never run them in parallel.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
