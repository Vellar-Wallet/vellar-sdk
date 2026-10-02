import { defineConfig } from "vitest/config";

// Pins vitest's project root to website/ itself. Without this, vitest's
// upward config search finds the monorepo root's vitest.config.ts (it
// configures the vellar-sdk package's own test suite) and tries to load it
// using whatever `vitest` package resolves from the repo root — which isn't
// installed there (website/ isn't one of the root package.json's npm
// workspaces), so every run failed before even collecting a test file.
export default defineConfig({
  test: {
    root: __dirname,
  },
});
