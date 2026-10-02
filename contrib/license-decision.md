# License Decision: AGPL-3.0 Transitive Dependency

> Intended destination: `reference/license.md` (does not exist on `dev` yet). This
> file stays in `contrib/` per [CONTRIBUTING.md](../CONTRIBUTING.md) rule 3 —
> a maintainer can move it verbatim once `reference/` exists, or say the path
> should be different.

## Finding

The dependency tree contains exactly one copyleft package:

```
vellar-sdk -> passkey-kit@0.16.5 -> @openzeppelin/relayer-plugin-channels@0.20.0
  -> @openzeppelin/relayer-sdk@1.10.0   (AGPL-3.0-or-later)
```

Verified directly against `package-lock.json`: `passkey-kit@0.16.5` depends on
`@openzeppelin/relayer-plugin-channels@^0.20.0` (MIT), which depends on
`@openzeppelin/relayer-sdk@^1.10.0`, whose lockfile entry declares
`"license": "AGPL-3.0-or-later"`. Everything else in the tree is permissive:
68 MIT, 6 Apache-2.0, 2 BSD-3-Clause, 1 ISC, no `UNLICENSED` packages.

## Exposure

Exposure is low, for four independent reasons:

1. **Transitive only.** `vellar-sdk` never depends on `@openzeppelin/relayer-sdk`
   directly; it arrives solely through `passkey-kit`.
2. **`passkey-kit` is a `devDependency`, and an *optional* `peerDependency`** (see
   `package.json`'s `peerDependenciesMeta.passkey-kit.optional: true`). In
   `package-lock.json`, `passkey-kit` and everything under it — including the
   AGPL package — carries `"dev": true`. That flag means a production install
   (`npm ci --omit=dev`, or what a consumer's own lockfile resolves for a
   non-optional peer that goes unfulfilled) never pulls this branch in at all.
3. **Appears in no `package.json` of this repo.** Not the root package, not
   `packages/cli`, not `packages/mcp-x402-payer` — `passkey-kit` is referenced
   only as a `peerDependency`/`devDependency` of the root package.
4. **Imported nowhere in source.** `grep -rn "from ['\"]passkey-kit['\"]"` across
   `src/`, `packages/cli/src`, and `packages/mcp-x402-payer/src` returns no
   matches. Nothing in the code vellar-sdk ships calls into `passkey-kit`, so
   nothing in vellar-sdk's own runtime can transitively reach
   `@openzeppelin/relayer-sdk` either.

## Does the wallet path ship to consumers in a form that matters?

No. `passkey-kit` being an *optional* peer dependency means vellar-sdk's
published package never bundles it, and a consumer who does not install
`passkey-kit` themselves never resolves `@openzeppelin/relayer-sdk` at all. A
consumer who *does* choose to install `passkey-kit` to use the passkey wallet
path is adding that dependency (and its AGPL-licensed sub-dependency) to their
own project directly — the same as if they had run `npm install passkey-kit`
without vellar-sdk in the picture. That is a decision made in the consumer's
own dependency tree, under their own license obligations, not something
vellar-sdk redistributes or bundles into its own published artifact.

## Decision

**No action required on vellar-sdk's own licensing.** vellar-sdk's published
package (the `dist/` produced by `npm run build`, per `files` in
`package.json`) never contains `@openzeppelin/relayer-sdk` or
`@openzeppelin/relayer-plugin-channels` — they are unreachable from anything
vellar-sdk ships, and unresolved entirely unless a consumer opts into
`passkey-kit` themselves.

This is recorded here as a decision on the record rather than an undocumented
condition. If either of these changes, this decision should be revisited:

- `passkey-kit` (or anything depending on `@openzeppelin/relayer-sdk`) becomes
  a required (non-optional, non-dev) dependency of vellar-sdk.
- Any file under `src/` or an in-scope package (`packages/cli`,
  `packages/mcp-x402-payer`) starts importing from `passkey-kit` or the
  `@openzeppelin/relayer-*` packages directly.
