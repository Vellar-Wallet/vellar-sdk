import { defineConfig } from "vitest/config";
import { sdkSourceAliases } from "./vitest.alias";

// The default suite is HERMETIC: no network, no local stack, no chain.
//
// Integration tests live in `*.integration.test.ts` and are excluded here on
// purpose. They need a locally-running facilitator and seller, and they must
// never be pointed at the shared hosted facilitator — the first settlement for
// a URL writes a permanent public catalog entry that nobody can delete. Run
// them deliberately with `npm run test:integration`.
export default defineConfig({
  // `vellar-sdk/*` self-imports resolve to source, so `npm test` does not
  // require a prior `npm run build`. See vitest.alias.ts.
  resolve: { alias: sdkSourceAliases },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/*.integration.test.ts",
    ],
  },
});
