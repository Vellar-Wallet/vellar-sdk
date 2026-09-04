import { defineConfig } from "vitest/config";
import { sdkSourceAliases } from "./vitest.alias";

// Dedicated config for the OPTIONAL load tests (`npm run test:load`). Load
// tests are excluded from the default hermetic suite (`vitest.config.ts`) so
// `npm test` stays fast; run this deliberately to exercise concurrent
// submission behavior and measure latency/error-rate at increasing concurrency.
export default defineConfig({
  // Keep the `vellar-sdk/*` self-import aliases so tests run against source.
  resolve: { alias: sdkSourceAliases },
  test: {
    include: ["**/*.load.test.ts"],
  },
});
