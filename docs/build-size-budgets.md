# Workspace Build-Size Regression Budgets

To catch accidental bundle bloat — such as pulling `@stellar/stellar-sdk` or a transitive Node dependency into a thin package build instead of keeping it in `tsup.config.ts` `external` — every workspace package in this repository has an enforced `dist/` runtime size budget (`src/build-size-budget.ts` and `scripts/build-size-budgets.json`).

## 1. Per-Package Size Budgets

Runtime bundle size counts all emitted JavaScript files (`.js`, `.cjs`, `.mjs`) under each package's `dist/` directory, excluding source maps (`.map`) and TypeScript declarations (`.d.ts`, `.d.cts`).

| Package | Directory | Baseline Runtime Size | `maxTotalBytes` Budget | `maxSingleFileBytes` Ceiling | Externalized Dependencies |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`vellar-sdk`** | `.` | ~145 KiB | **260 KiB** (`266,240 B`) | **120 KiB** (`122,880 B`) | `@stellar/stellar-sdk`, `zustand` |
| **`vellar-cli`** | `packages/cli` | ~32 KiB | **80 KiB** (`81,920 B`) | **60 KiB** (`61,440 B`) | `@stellar/stellar-sdk`, `@x402/core`, `@x402/stellar`, `commander`, `vellar-sdk` |
| **`vellar-mcp-x402-payer`** | `packages/mcp-x402-payer` | ~56 KiB | **120 KiB** (`122,880 B`) | **80 KiB** (`81,920 B`) | `@modelcontextprotocol/sdk`, `@stellar/stellar-sdk`, `@x402/core`, `@x402/stellar`, `vellar-sdk`, `zod` |

## 2. Running the Size Check

Build all workspace packages and run `npm run check:size`:

```bash
npm run build
npm run build --workspace vellar-cli
npm run build --workspace vellar-mcp-x402-payer
npm run check:size
```

If any package exceeds `maxTotalBytes` or `maxSingleFileBytes`, the script exits with status `1` and prints which package failed, the measured size, and the exact byte/KiB overage.

## 3. How to Deliberately Raise a Budget

When a new feature or entry point legitimately increases a package's compiled output size:

1. **Verify `external` in `tsup.config.ts` first**: Confirm the size increase comes from first-party source code rather than an un-externalized third-party dependency.
2. **Inspect the per-file breakdown**: Run `node scripts/check-build-size.mjs --json` to see `runtimeBytes` and `largestRuntimeFile` for the affected package.
3. **Update `scripts/build-size-budgets.json` and `DEFAULT_BUILD_SIZE_BUDGETS` in `src/build-size-budget.ts`**:
   - Set `measuredBaselineBytes` to the new measured runtime size.
   - Increase `maxTotalBytes` (and `maxSingleFileBytes` if needed) with ~25–40% headroom.
4. **Document the rationale in your PR description**: Note which feature or entry point added the bytes so reviewers can confirm the tradeoff is intentional.
