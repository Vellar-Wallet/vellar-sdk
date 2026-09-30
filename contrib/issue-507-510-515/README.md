# Ceiling-vs-settled, the advisory gate, and documented-URL drift (#507, #510, #515)

Three issues, one batch. All work is inside `contrib/` per `CONTRIBUTING.md`;
each module states below what a maintainer has to change outside it to close the
issue for real.

Line references are against `dev` @ `800f396`, the base this targets. On that
base none of the three is implemented: the MCP payer ledger has no reservation
and records the signed amount, the audit gate is a bare
`npm audit --audit-level=critical` with no date, and there is no documented-URL
checker at all. So each module is the complete implementation, scoped to
`contrib/` per the contribution policy, with a lift recipe for the maintainer
who wires it into core.

| File | Issue | What it is |
| --- | --- | --- |
| `upto-settlement-receipt.ts` | #510 | The ceiling/settled receipt, the budget that reserves the ceiling and debits the settled amount, and the CLI's two-line render. |
| `audit-advisory-policy.mjs` | #515 | The allowlist as a testable function, with the counts computed, the allowlist pinned to the chain, and a dated expiry. |
| `advisory-status-2026-09-30.md` | #515 | The re-check record, with the evidence. |
| `doc-url-gate.mjs` | #507 | The URL checker's policy as a testable function, with the four holes closed. |

```sh
npx vitest run contrib/issue-507-510-515        # 91 tests
node contrib/issue-507-510-515/audit-advisory-policy.mjs   # reproduce the #515 counts
node contrib/issue-507-510-515/doc-url-gate.mjs             # run the #507 check for real
```

---

## #510 — surface the ceiling-versus-settled gap for `upto` payments

### What is on the base today

Nothing. `authorizedCeiling` appears nowhere in `src/` or `packages/`;
`X402Settlement` (`src/x402-types.ts:95-103`) has a single `amount`;
`SpendLedger` (`packages/mcp-x402-payer/src/ledger.ts:22-29`) offers
`assertWithinCeiling` + `record(asset, amount)` with no reservation, so it
records the signed amount; `src/x402-client.ts:325` debits the budget at that
same signed amount; and `packages/cli/src/commands/pay.ts:275-279` prints one
line, `Settlement: <tx>`. A caller cannot learn "you authorized X, you were
charged Y" at all, and an `upto` session budget depletes at the rate of
authorizations rather than spend.

The settled amount is not even parsed on this base: `SettleResult`
(`src/x402-guards.ts:186-193`) has no `amount` field and
`classifySettlement` (line 273) does not read one.

### Three things this has to get right

**1. The pair, not one figure.** `SettlementReceipt` carries the ceiling and the
settled amount together, plus `unusedCeiling` and `settledBelowCeiling`, so a
caller never reconstructs either. A cheap metered call and an expensive ceiling
the buyer got away with are indistinguishable if you keep only one of them.

**2. The trusted source.** The settled amount comes only from the facilitator's
`X-PAYMENT-RESPONSE` header, which is built from the contract's emitted transfer
event. Not from the resource body, which the CLI reads today (line 275) and which
is authored by the party being paid — a payee that under-reports keeps a buyer's
session alive, and one that over-reports drains it.

**3. Falling back in the safe direction.** A malformed settled amount falls back
to the ceiling, never coerces: charging the ceiling can only refuse a payment
that would otherwise have been allowed, while parsing garbage into a number lets
a server-supplied string set the debit. A settled amount *above* the ceiling is
clamped and flagged — `upto` bounds `actual_amount <= max_amount` on-chain, so a
larger figure is a contract violation, not a bigger bill.

`createSessionBudget` reserves the ceiling for the whole in-flight window and
debits the receipt's settled amount on confirmation, so a second caller arriving
mid-payment is refused while nothing is known yet. `resolveSpendDebit` states the
three-way rule in one place: settled → the measured figure; indeterminate → the
ceiling, failing closed (a ledger that ignored a possibly-successful payment
would under-count real spend and let the ceiling be exceeded later); not-spent →
nothing.

### Integration into Core

1. **`src/x402-types.ts`** — add to `X402Settlement` (line 95):
   ```ts
   /** The ceiling the buyer signed. Equal to `amount` for `exact`. */
   authorizedCeiling: bigint;
   /** True when the chain moved less than the buyer authorized. */
   settledBelowCeiling: boolean;
   ```
2. **`src/x402-guards.ts`** — add `amount?: string` to `SettleResult` (line 186)
   and parse it in `classifySettlement` (line 273) with a digits-only test,
   returning it on the `settled` branch. Then make `decodeSettlementHeader`
   (line 325) pass it through instead of dropping it. The full parser is
   `parseSettledAmount` in this module, and the reasons for each of its three
   behaviours are in `upto-settlement-receipt.ts`.
3. **`src/x402-client.ts`** — `readSettlement` (line 335) takes the settled
   figure from the decode and sets `authorizedCeiling` to the signed `amount`.
   Then the budget record at line 325 becomes
   `record(rule, settlement?.settledAmount ?? amount)`, which is the
   acceptance criterion: budgets deplete against spend, not authorizations.
   Keep the `?? amount` fallback — a facilitator that omits the amount must still
   be charged the ceiling.
4. **`packages/mcp-x402-payer/src/ledger.ts`** — extend `SpendLedger` (line 22)
   with `reserve(asset, ceiling)` / `settle(asset, requested, settled)` /
   `release(asset, requested)` and the `reserved` field `SpendSnapshot` (line 15)
   is missing, so an in-flight payment is visible to a concurrent caller. Then
   call `settle` with the receipt's settled amount in `payer.ts`.
5. **`packages/cli/src/commands/pay.ts`** — replace the body read at line 275
   with `settlementReceiptFromResponse(paid, …)` and render via
   `formatSettlementReceiptLines`. The signed ceiling is `price`; the asset is
   `chosen.asset`; the network is `opts.network`. Drop the body read entirely
   rather than preferring it — "the header if present, else the body" still lets
   a seller choose the figure whenever the header is absent.
6. **`src/x402-client.test.ts`** — port the fallback and clamp cases from
   `upto-settlement-receipt.test.ts`.

The `upto` build path still does not exist — `src/x402-client.ts:188` only ever
emits a SEP-41 `transfer`, and an `upto` payment needs an invocation of the
deployed contract's 8-argument `settle`. That is the "buyer-side `upto` support"
dependency, and it is not a reporting problem. The receipt is correct for `exact`
today (the two figures are equal, `settledBelowCeiling` is `false`) and is the
type an `upto` path should return when it lands.

---

## #515 — resolve the toml advisory chain, or document the decision with an expiry

### What is on the base today

`ci.yml:29` and `publish.yml:33` both run a bare
`npm audit --audit-level=critical`, with the comment "Gate softened from
`--audit-level=high` to `--audit-level=critical` … Restore to
`--audit-level=high` when upstream resolves." There is no allowlist, no
expiry, and no date. The comment asks a question and defers it forever, which
is the risk the issue names: a temporary softening becoming permanent quietly,
and `--audit-level=critical` admitting any *new* high anywhere in the tree. All
three acceptance criteria are unmet.

### The re-check

Full record with evidence in [`advisory-status-2026-09-30.md`](./advisory-status-2026-09-30.md).
Two material findings.

**Upstream HAS resolved it, and neither half needs a major-version override** —
the one thing the current rationale implicitly relies on not being possible.

- `smol-toml`: the advisory's vulnerable range is `<=1.7.0`, the root
  `@stellar/stellar-sdk@16.2.0` already depends on `^1.6.1`, and 1.7.1 through
  1.9.0 exist upstream. An in-range `overrides` entry closes it — the same shape
  as the `fast-uri: 3.1.7` override that already closes four highs.
- `toml`: **`passkey-kit@0.17.0` dropped `@openzeppelin/relayer-plugin-channels`
  entirely** (verified across 0.17.0, 0.17.3, 0.18.0, 0.18.3, 0.19.0, 0.19.1).
  The `toml@3.0.0` copy exists only under that package, so a MINOR bump removes
  the chain outright rather than overriding it. It needs the declared peer range
  `>=0.13.0 <0.17.0` widened, which is correctly a maintainer decision.

**The two highs are not all one chain.** Four of the five are the `passkey-kit`
chain the issue describes. The fifth, `smol-toml@1.7.0`, sits at
`node_modules/smol-toml` — the root path, `dev: false` in the lockfile —
reached from the production `@stellar/stellar-sdk@16.2.0` that this package
declares as a direct `peerDependency`. The `≤15.x` copy depends on `toml`, not
`smol-toml`. So the dev-only reachability argument does not apply to the
advisory that is actually on the production path, and an allowlist entry that
records it as part of the dev chain is carrying a justification that is false.

Also worth recording: the issue was filed against "5 high, 4 moderate, 1 low";
the moderates are now 7. And a header asserting "all five highs" sits next to a
three-advisory allowlist because **five packages** and **three advisories** are
different numbers — which is why `evaluateAuditReport` computes both instead.

### What this module adds

`evaluateAuditReport` is the same policy as a pure function, so it is testable,
plus three checks the inline script cannot make:

- **Counts are computed, not asserted in a comment.** `packageCounts` vs
  `advisoryCounts` vs `countReconciliation` — advisories counted *distinctly*,
  since npm reports one advisory once per carrying package.
- **Stale allowlist entries surface.** An allowlisted advisory that is no longer
  reported is a fix upstream, reported as `resolvedUpstream` so a resolved risk
  stops reading as an open one.
- **The allowlist is pinned to the chain, not to the advisory.** Each entry
  declares the `package-lock.json` node paths it may appear on; anywhere else is
  a different exposure wearing a familiar label, and it fails. This is the check
  that would have caught the smol-toml misattribution on the day it was written.
- **The review date fails closed.** After `2026-12-15` the verdict is not ok and
  CI reports the expired checkpoint. Passing *on* the date, so the day itself is
  actionable.

`RESOLUTION_PLAN` records the two routes, and a test asserts every allowlisted
advisory has one — so "we are carrying a known risk" cannot quietly become "we
have no idea".

### Integration into Core

1. **`.github/workflows/ci.yml:29` and `publish.yml:33`** — replace
   `npm audit --audit-level=critical` with
   `node contrib/issue-507-510-515/audit-advisory-policy.mjs`, or move
   `evaluateAuditReport` into a script of the repo's own and call that. Either
   way the `critical` floor goes and the `high` floor comes back, and a new high
   outside the known chain becomes a build failure.
2. **`package.json:135-136`** — add `"smol-toml": "1.9.0"` to `overrides` and
   re-run the gate. Expect one fewer allowlist entry.
3. **`package.json:125-127` and `143`** — widen
   `peerDependencies["passkey-kit"]` to admit `0.17.0` and bump the
   `devDependency` to `^0.17.0`, then re-run. Expect the `toml` entries to drop
   out; all three can then come off the allowlist and the gate returns to a bare
   `npm audit --audit-level=high`.

Steps 2 and 3 are `package.json` range changes, which the existing comment at
`ci.yml:19-21` says are "reported and decided, not forced through by CI". They
are flagged here for that decision, not proposed as a CI change.

---

## #507 — a CI gate that every documented URL resolves

### What is on the base today

Nothing. There is no `scripts/verify-doc-urls.mjs`, no
`.github/workflows/verify-doc-urls.yml`, and nothing that requests a documented
URL — so the incident the issue describes (three hosted services going live →
suspended with no signal, 17 URL occurrences silently wrong) is exactly as
possible today. All three acceptance criteria are unmet.

### What this module has to get right

**1. The shipped-default table has to be complete.** A stale constant is a live
bug rather than a stale doc: the CLI and the MCP payer dial these without the
reader typing anything. This tree ships at least nine more service URLs than the
two a docs-only scan would find:

| File | URL |
| --- | --- |
| `packages/cli/src/commands/pay.ts` | `soroban-testnet.stellar.org`, `mainnet.sorobanrpc.com` |
| `packages/mcp-x402-payer/src/signer.ts` | `soroban-testnet.stellar.org`, `mainnet.sorobanrpc.com` |
| `packages/cli/src/commands/inspect.ts` | `horizon-testnet.stellar.org`, `horizon.stellar.org` |
| `src/config.ts` | `soroban-testnet.stellar.org`, `horizon-testnet.stellar.org`, `horizon.stellar.org` |

**2. Default drift must fail, not warn.** Gating is keyed on **host**, so a
default quietly repointed at an undeclared host stops being gated at all — a
silent demotion from "fails the build" to "someone else's uptime", reached by
editing one string, with no decision made by anyone. `auditShippedDefaults` makes
drift a failure in two forms: the file no longer contains the expected URL, or
the host is in neither `OWNED_HOSTS` nor the newly-declared
`THIRD_PARTY_DEFAULT_HOSTS`. Being third-party is fine and stays a warning;
being **undeclared** is not. The two lists answer different questions — "who do
we operate" (gating) and "who do we ship a default for" (checked, not gated) —
and conflating them is how Stellar's uptime ends up blocking an unrelated merge.

**3. The scan surface has to exclude fixtures and include everything else.** A
`https://res.test/paid` literal in a test is not a documented URL, and dialling
it competes for the concurrency pool real endpoints share. Meanwhile the
repo-root `README.md`, `docs/`, and `contrib/` are exactly where a URL gets
documented and forgotten. `EXCLUDED_PATH` and `SCAN_TARGETS` handle both.

### What this module adds

Everything that makes a network call is injected, so the policy is testable
without a socket — the difference between a check that gets exercised and one
that only runs when something is already broken.

- `SHIPPED_DEFAULTS` covers all 11 (verified: 0 drift against the tree today).
- `EXCLUDED_PATH` drops `*.test.ts`, `*.spec.ts`, `test/`, `tests/`,
  `__fixtures__/`, `__mocks__/`, and `*.d.ts`.
- `SCAN_TARGETS` covers `website/content`, `packages`, `src`, `scripts`,
  `contrib`, `docs`, `README.md`, `CONTRIBUTING.md`.
- `OWNED_HOSTS` probes each repo-operated host at the path the docs tell a reader
  to call, not at the origin — the facilitator answers `/supported` and 404s at
  `/`, so probing the root would report a healthy service as dead.
- 402-as-success (the correct answer for a paid route), the explorer's `allow404`,
  and "name each failing URL and its files" each have their own test.
- The posture is the one the issue asks for: scheduled rather than per-PR, gating
  only on what the repo controls.

### Integration into Core

1. **Add `.github/workflows/verify-doc-urls.yml`** mirroring `verify-merged.yml`:
   `schedule: - cron: "23 4 * * *"` plus `workflow_dispatch`, `permissions:
   contents: read`, `actions/setup-node@v4` at node 22, and a single
   `run: node contrib/issue-507-510-515/doc-url-gate.mjs`. No `npm ci` — the
   script has no dependencies. Off the hour and off the peak minute so it does
   not join the thundering herd.
2. **Optionally** move `doc-url-gate.mjs` to `scripts/verify-doc-urls.mjs` and
   add a `verify:urls` npm script alongside `verify:merged`, so it can be run
   locally the way `check:docs` can.

### One thing left alone

`.github/workflows/hackathon-keepalive.yml` pings the same four hosts under a
stricter all-gating policy, with its `schedule:` block commented out. That is a
maintainer call about a hackathon deployment's lifetime, not a documentation
check, so this batch does not touch it. Worth noting that the host list is
duplicated, and `OWNED_HOSTS` is the one that should win.
