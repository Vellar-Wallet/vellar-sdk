import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sdkSourceAliases } from "../../vitest.alias";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  resolve: { alias: sdkSourceAliases },
  test: {
    include: ["src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.integration.test.ts",
      "**/*.load.test.ts",
      "contrib/**",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      reportsDirectory: "contrib/coverage-runner/report",
      reporter: ["text", "html"],
      reportOnFailure: true,
    },
  },
});