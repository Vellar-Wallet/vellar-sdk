# x402 workspace version alignment check — #618

Contributor-scoped implementation for issue #618. Everything here lives in
`contrib/`; wiring into `package.json` and `.github/workflows/ci.yml` is left
to a maintainer.

## What it does

Reads every `package.json` in the npm workspace (`root` + every path matched by
the root's `workspaces` field), collects the declared `@x402/core` and
`@x402/stellar` specifiers, resolves each to its major version, and fails when
any two workspaces declare incompatible majors.

Minor/patch differences are intentionally allowed — the major version is the
protocol-compatibility boundary for the x402 packages.

## Files

| File | What it does |
| --- | --- |
| [check-x402-versions.mjs](check-x402-versions.mjs) | Library + CLI. Run directly with `node` or import the exported functions in tests. |
| [check-x402-versions.test.ts](check-x402-versions.test.ts) | 30 unit tests — happy path, all failure modes, real-workspace smoke-check. |
| [\_\_fixtures\_\_/](\_\_fixtures\_\_/) | Minimal workspace trees used by the tests (no deps to install). |

## Running the check manually

```sh
# from the repo root — checks the real workspace
node contrib/x402-version-check/check-x402-versions.mjs

# against a specific directory
node contrib/x402-version-check/check-x402-versions.mjs --root /path/to/workspace
```

## Running the tests

```sh
# from the repo root
npx vitest run contrib/x402-version-check/check-x402-versions.test.ts
```

## Integration into core

A maintainer should:

1. Move `check-x402-versions.mjs` to `scripts/check-x402-versions.mjs`.
2. Add `"check:x402-versions": "node scripts/check-x402-versions.mjs"` to the
   root `package.json` scripts.
3. Insert `- run: npm run check:x402-versions` into `.github/workflows/ci.yml`
   between the `check:docs` and `npm test` steps.
4. Move `check-x402-versions.test.ts` and `__fixtures__/` to `scripts/` so the
   tests sit next to the script.
