# Issue #463 — compose the client-side guard layers into one threat-model section

Issue #463 explicitly pre-approves changes outside `contrib/`, scoped to
`website/content/docs/architecture/threat-model.md` and
`website/content/docs/buyers/spend-controls.md`:

> This issue requires changes OUTSIDE the contrib/ folder. That scope is
> pre-approved here, so the usual contrib-only restriction does not apply to
> a pull request that implements THIS issue and stays within the paths named
> above.

A PR implementing exactly that scope (#773, branch `docs/threat-model-463`,
commit `4219355`) was nonetheless auto-closed by the contrib-only bot, which
does not read per-issue pre-approval text — the same thing that happened to
issue #408's work (see `contrib/x402-wave-407-411/README.md`) and to the
core-repairs work in `contrib/repair-wave-494-495-496-499/`. This folder
follows the same resolution those used: the real change lives on the closed
PR's branch, and this folder carries the identical diff as a patch so a
maintainer can lift it directly.

```bash
git fetch https://github.com/ebubechi-ihediwa/vellar-sdk docs/threat-model-463
git apply contrib/threat-model-463/threat-model-463.patch   # verified clean against dev
```

(Verified against a fresh `upstream/dev` checkout, commit `9655a83`, with
`git apply --check` — applies cleanly, no conflicts.)

## What the patch does

Four modules implement client-side guards on the x402 payment path —
`src/x402-signer-capabilities.ts`, `src/x402-budget-attributes.ts`,
`src/x402-auth-entry.ts`, and `src/x402-untrusted.ts` — each honest in
isolation about what it does and does not cover. Nothing composed them, and
`threat-model.md` predated two of them (#224, #225) entirely.

**`website/content/docs/architecture/threat-model.md`**
- New section, "Client-side guard layers in the x402 payment path": a table
  enumerating all four modules (module + exact export names, where each
  runs, what it prevents, what it does not prevent), the central distinction
  as its own callout — only the on-chain spending-limit policy bounds a
  compromised agent process; every client-side layer is fail-fast narrowing
  for a well-behaved process, not a replacement for consensus (the V-1
  lesson) — a "The recipient gap" subsection restating the policy's
  token/amount-only scope precisely and what `assertAuthEntryInvocation`
  does and does not close, and a "Reconciling with the security audit"
  subsection mapping the fence to V-3/V-5/V-6/V-11 and noting the two newer
  modules (#224, #225) postdate the audit and are simply absent from it —
  not in disagreement with it.
- Added the three new layers' thrown errors (`AuthEntryMismatchError`,
  `CapabilityDeniedError`, `BudgetAttributeDeniedError`) to the existing
  "When it fails" table, and a link to the new section from "Next steps".
- Fixed a stale factual claim found while cross-checking against the source:
  the existing "Prompt injection in the MCP payer" section still said the
  fence nonce is 8 hex characters (32 bits) — the pre-V-11 width.
  `src/x402-untrusted.ts`'s `NONCE_BYTES` has been 16 (128 bits) since V-11;
  the audit itself documents the raise. Corrected to match the actual
  constant.

**`website/content/docs/buyers/spend-controls.md`**
- New "Capability and attribute scoping" section showing the real config
  shape for `capabilities` (on the signer) and
  `budgetAttributes`/`budgetAttributeTracker` (on `x402` config),
  cross-referencing the new threat-model section for the full composition
  rather than restating it, plus two new rows in "When it fails" for the
  errors each one throws.

## Verification

This is a documentation-only change with no executable surface. What was
checked instead of a unit test:

- Every cited module (`x402-auth-entry.ts`, `x402-signer-capabilities.ts`,
  `x402-budget-attributes.ts`, `x402-untrusted.ts`, `x402-client.ts`,
  `client.ts`) was read directly and every claim (export names, config
  shape, defaults, error classes) cross-checked against the actual source,
  not memory or other docs.
- Every property name in the new code snippets (`capabilities`,
  `resourceType`, `action`, `budgetAttributes`, `merchant`, `category`,
  `maxAmount`, `periodMaxAmount`) confirmed against the real
  `BudgetAttributeRule`/`CapabilityRule` interfaces.
- `x402-untrusted` confirmed as a subpath export (`vellar-sdk/x402-untrusted`),
  not root-exported, and `CapabilityRule`/`BudgetAttributeRule` confirmed as
  root-exported (`export *` in `src/index.ts`) — both stated precisely in
  the doc rather than guessed.
- The V-3/V-5/V-6/V-11 mapping and the #224/#225 dates confirmed against
  `docs/security-audit.md` directly.
- `capabilities` confirmed as configured on the signer passed to
  `createVellarWallet`'s `x402.signer` (via the caller's own
  `createSessionKeySigner(...)` call), not as a separate flat option on
  `x402` config — the doc states this precisely rather than implying a
  facade option that does not exist.

## A note on `npm run typecheck` / `npm test` / `npm run build`

Unrelated to this change, but worth recording here since it affects every
PR right now: `src/x402-signer.ts` is currently broken on `dev` — a missing
`/**` reported in #494 and nominally closed via #542, except #542 only added
a `.patch` file under `contrib/repair-wave-494-495-496-499/` describing the
fix; nothing ever applied it to `src/`. Re-confirmed against the same fresh
`upstream/dev` checkout used above (commit `9655a83`): `npm run typecheck`,
`npm test`, and `npm run build` all fail with the exact symptoms #494
describes, identically with or without this patch (it touches only two
`.md` files, which `tsconfig.json`'s `include: ["src"]` never reaches).
Flagged on #494 for a maintainer.
