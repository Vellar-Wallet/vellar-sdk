# Bundle Size Budget Check (#684)

Reference implementation for a size-check step that measures the built
`dist/` output for the root package, `packages/cli`, and
`packages/mcp-x402-payer`, and fails CI when a package exceeds its budget.

## What It Does

- `check-bundle-size.mjs` sums the byte size of every file under each
  package's `dist/` directory (including nested chunk files and type
  declarations) and compares it against a per-package budget in
  `BUDGETS_KB`.
- Prints a clear, per-package pass/fail line naming which package is over
  budget and by how much.
- `--update-budgets` prints the exact object-literal snippet to paste into
  `BUDGETS_KB` after a deliberate, reviewed size increase, measured from the
  current build rather than hand-typed, without writing any file itself (a
  human still has to paste it in and explain the increase in the PR).
- If a package's `dist/` directory doesn't exist yet (the build step hasn't
  run), that package is skipped rather than treated as a failure, so the
  script is safe to run standalone before a build in local development.

## Verification (manually run, see note on CI below)

```
PASS under-budget
PASS over-budget
PASS names-package
PASS skips-missing-dist
PASS sums-nested-files
ALL PASS
```

Also smoke-tested the CLI entrypoint directly against this repo (with no
`dist/` built yet in this environment), confirming it reports each package
as skipped rather than crashing or false-failing:

```
[bundle-size] root: SKIPPED — dist directory not found at dist; run the build first.
[bundle-size] cli: SKIPPED — dist directory not found at packages/cli/dist; run the build first.
[bundle-size] mcp-x402-payer: SKIPPED — dist directory not found at packages/mcp-x402-payer/dist; run the build first.
```

## A note on the current budget numbers

`BUDGETS_KB` in `check-bundle-size.mjs` ships with placeholder budgets (250KB
root, 150KB each for `cli` and `mcp-x402-payer`) rather than numbers measured
from a real build, because this reference implementation was written without
being able to run `npm install && npm run build` in the environment it was
authored in (see this PR's test plan for why). **Before wiring this into CI**,
run:

```sh
npm run build
node scripts/check-bundle-size.mjs --update-budgets
```

and paste the printed, measured-with-headroom values into `BUDGETS_KB`,
replacing the placeholders.

## Integration into Core

1. Copy `check-bundle-size.mjs` to `scripts/check-bundle-size.mjs` and
   `check-bundle-size.test.ts` to `scripts/check-bundle-size.test.ts`.
2. Calibrate `BUDGETS_KB` per the note above.
3. Add a root `package.json` script:
   ```json
   "check:bundle-size": "node scripts/check-bundle-size.mjs"
   ```
4. Add a CI step after the existing build step in the relevant workflow
   (wherever `npm run build` already runs for PRs):
   ```yaml
   - run: npm run build
   - run: npm run check:bundle-size
   ```
5. Document the `--update-budgets` workflow (run locally after a build,
   paste the printed snippet into `BUDGETS_KB`, explain the increase in the
   PR description) in `CONTRIBUTING.md` or the relevant operators doc, so a
   deliberate size increase has a documented path instead of needing someone
   to hand-edit budget numbers.
