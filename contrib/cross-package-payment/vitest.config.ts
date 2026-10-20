import { defineConfig } from "vitest/config";
import { sdkSourceAliases } from "../../vitest.alias";

// Opt-in only. The root config excludes *.integration.test.ts, so this contract
// runs solely when a developer or CI invokes this config with the explicit gate.
export default defineConfig({
  resolve: { alias: sdkSourceAliases },
  test: {
    include: ["contrib/cross-package-payment/*.integration.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
