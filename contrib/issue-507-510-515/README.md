# Ceiling-vs-settled, the advisory gate, and documented-URL drift (#507, #510, #515)

Three issues, one batch. All work is inside `contrib/` per `CONTRIBUTING.md`;
each module states below what a maintainer has to change outside it to close the
issue for real.

**Read this first:** all three issues have *partial* implementations already in
`dev`. This batch does not reimplement them. It closes the gaps that remain and,
for #515, corrects the record — the re-check the issue asked for found that the
recorded upstream status is wrong in two material ways.

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

### What already landed

`packages/mcp-x402-payer/` and `packages/cli/` already report both figures
(`packages/mcp-x402-payer/src/payer.ts:133` adds `authorizedCeiling` next to
`amount`; `packages/cli/src/commands/pay.ts:306-315` prints `Authorized:` and
`Settled:`; `packages/mcp-x402-payer/src/ledger.ts:73-81` debits the settled
figure). That work came in via `b38d0a5` / `500bf8a` from a `contrib/issue-511-510/`
folder that `afb9c50` then deleted. The MCP payer's acceptance criteria are met.

### What still does not

Three gaps, each a different kind of wrong.

**1. The SDK core collapses the pair.** `X402Settlement` (`src/x402-types.ts:95-103`)
has a single `amount`, which `src/x402-client.ts:335-350` fills with the
**signed** amount. The metered figure is already parsed by `classifySettlement`
(`src/x402-guards.ts:325-341`) and then thrown away by `decodeSettlementHeader`
(`src/x402-guards.ts:350-356`). So a caller of `wallet.x402.fetch()` cannot learn
"you authorized X, you were charged Y" — which is the issue's entire complaint —
and `src/x402-client.ts:325` debits the budget at the ceiling. Under `upto` that
over-charges by the unused ceiling on every call.

**2. The CLI reads the settled amount from the wrong party.**
`packages/cli/src/commands/pay.ts:275-304` takes it from the **seller's JSON
body** (`body.settlement.amount`). That field is authored by the party being
paid. The facilitator's `X-PAYMENT-RESPONSE` header — built from the contract's
emitted transfer event — is the settlement evidence the buyer can trust, and the
CLI never reads it.

**3. A missing measurement prints like a real one.** When the facilitator omits
the amount, the receipt falls back to the ceiling. That is correct for budgeting,
but the CLI's `(exact scheme: settled in full)` line makes a fallback read as a
measurement. "Unknown" and "charged in full" are different facts.

### What this module adds

`SettlementReceipt` pairs the two figures and always carries both, so a caller
never reconstructs either. Three invariants, each with a test:

- **The settled amount comes only from the facilitator's settle header.** A
  seller-supplied field is never a source, in either direction: a payee that
  under-reports keeps a buyer's session alive, and one that over-reports drains
  it.
- **A malformed settled amount falls back to the ceiling, never coerces.**
  Charging the ceiling can only refuse a payment that would otherwise have been
  allowed; parsing garbage into a number lets a server-supplied string set the
  debit.
- **A settled amount above the ceiling is clamped and flagged.** `upto` bounds
  `actual_amount <= max_amount` on-chain, so a larger figure is a contract
  violation, not a bigger bill — and reporting it as spend would let a
  misbehaving facilitator push a budget past what the buyer authorized.

`createSessionBudget` reserves the ceiling for the whole in-flight window and
debits the receipt's settled amount on confirmation, so a large ceiling no longer
drains a budget that only ever spent a fraction of it. `resolveSpendDebit` states
the three-way rule in one place: settled → the measured figure; indeterminate →
the ceiling, failing closed (a ledger that ignored a possibly-successful payment
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
2. **`src/x402-guards.ts`** — make `decodeSettlementHeader` (line 350) return
   `settledAmount` from the `classifySettlement` result it already computes
   rather than dropping it. It is a two-line change; the value is already parsed
   four lines above and discarded.
3. **`src/x402-client.ts`** — `readSettlement` (line 335) takes the settled
   figure from the decode and sets `authorizedCeiling` to the signed `amount`.
   Then the budget record at line 325 becomes
   `record(rule, settlement?.settledAmount ?? amount)`, which is the
   acceptance criterion: budgets deplete against spend, not authorizations.
   Keep the `?? amount` fallback — a facilitator that omits the amount must still
   be charged the ceiling.
4. **`packages/cli/src/commands/pay.ts`** — replace the `body.settlement.amount`
   read (line 275) with `settlementReceiptFromResponse(paid, …)` and render via
   `formatSettlementReceiptLines`. The signed ceiling is `price`; the asset is
   `chosen.asset`; the network is `opts.network`. Drop the body read entirely
   rather than preferring it — "the header if present, else the body" still lets
   a seller choose the figure whenever the header is absent.
5. **`src/x402-client.test.ts`** — port the fallback and clamp cases from
   `upto-settlement-receipt.test.ts`.

The `upto` build path still does not exist — `src/x402-client.ts:186-198` only
ever emits a SEP-41 `transfer`, and an `upto` payment needs an invocation of the
deployed contract's 8-argument `settle`. That is the "buyer-side `upto` support"
dependency, and it is not a reporting problem. The receipt is correct for `exact`
today (the two figures are equal, `settledBelowCeiling` is `false`) and is the
type an `upto` path should return when it lands.

---

## #515 — resolve the toml advisory chain, or document the decision with an expiry

### What already landed

`scripts/audit-gate.mjs` already replaced the softened `--audit-level=critical`
with a per-advisory URL allowlist at a `high` floor, both `ci.yml:38` and
`publish.yml:32` call it, and it carries a `2026-12-15` hard stop. It passes
today. The mechanism satisfies all three acceptance criteria.

### What the re-check found

Full record with evidence in [`advisory-status-2026-09-30.md`](./advisory-status-2026-09-30.md).
Two material corrections:

**The recorded upstream status is wrong. Upstream has resolved it, and neither
half needs a major-version override** — the one thing the current rationale
rules out.

- `smol-toml`: the advisory's vulnerable range is `<=1.7.0`, the root
  `@stellar/stellar-sdk@16.2.0` already depends on `^1.6.1`, and 1.7.1 through
  1.9.0 exist upstream. An in-range `overrides` entry closes it — the same shape
  as the `fast-uri: 3.1.7` override that already closes four highs.
- `toml`: **`passkey-kit@0.17.0` dropped `@openzeppelin/relayer-plugin-channels`
  entirely** (verified across 0.17.0, 0.17.3, 0.18.0, 0.18.3, 0.19.0, 0.19.1).
  The `toml@3.0.0` copy exists only under that package, so a MINOR bump removes
  the chain outright rather than overriding it. It needs the declared peer range
  `>=0.13.0 <0.17.0` widened, which is correctly a maintainer decision.

**The `smol-toml` entry's stated reason is factually wrong, and it is attached to
the more serious of the two highs.** `scripts/audit-gate.mjs:35` records
GHSA-7w5x as "Transitive of @stellar/stellar-sdk ≤15.x. Not reachable: the SDK
parses no TOML at runtime." It is not. `smol-toml@1.7.0` sits at
`node_modules/smol-toml` — the root path, `dev: false` in the lockfile — reached
from the production `@stellar/stellar-sdk@16.2.0` that this package declares as a
direct `peerDependency`. The `≤15.x` copy depends on `toml`, not `smol-toml`. So
the dev-only reachability argument does not apply to the advisory that is
actually on the production path.

Also worth recording: the issue was filed against "5 high, 4 moderate, 1 low";
the moderates are now 7, and the header's "all five highs" sits directly above a
three-URL `ALLOWED` list because **five packages** and **three advisories** are
different numbers.

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

1. **`scripts/audit-gate.mjs:35`** — correct the GHSA-7w5x reason to name the
   production path. This is worth doing whether or not the bumps land: a wrong
   justification is worse than an honest narrow one, because the next person to
   re-check will trust it.
2. **`package.json:135-137`** — add `"smol-toml": "1.9.0"` to `overrides` and
   re-run the gate. Expect one fewer allowlist entry.
3. **`package.json:125-133`** — widen `peerDependencies["passkey-kit"]` to admit
   `0.17.0`, bump the `devDependency` to `^0.17.0`, and re-run. Expect the
   `toml` entries to drop out; all three can then come off the allowlist and the
   gate returns to a bare `npm audit --audit-level=high`.
4. **`scripts/audit-gate.mjs`** — optionally replace its body with
   `evaluateAuditReport` + `formatVerdict` from this module, keeping the
   `REVIEW_BY` hard stop. The behavioural differences are the three checks above.

Steps 2 and 3 are `package.json` range changes, which the existing comment at
`ci.yml:19-21` says are "reported and decided, not forced through by CI". They are
flagged here for that decision, not proposed as a CI change.

---

## #507 — a CI gate that every documented URL resolves

### What already landed

`scripts/verify-doc-urls.mjs` plus `.github/workflows/verify-doc-urls.yml`
(daily, `permissions: contents: read`, no `npm ci`) already do the job the issue
asks for: they enumerate URLs, treat 402 as success, and name the file in each
failure. The posture is right — scheduled rather than per-PR, gating only on
hosts the repo operates. The three acceptance criteria are met.

### What still does not

**1. The shipped-default table is incomplete.** `CODE_DEFAULTS`
(`scripts/verify-doc-urls.mjs:53-56`) pins two files. This tree ships at least
nine more service URLs as constants, including the SDK's own network config:

| File | URL |
| --- | --- |
| `packages/cli/src/commands/pay.ts` | `soroban-testnet.stellar.org`, `mainnet.sorobanrpc.com` |
| `packages/mcp-x402-payer/src/signer.ts` | `soroban-testnet.stellar.org`, `mainnet.sorobanrpc.com` |
| `packages/cli/src/commands/inspect.ts` | `horizon-testnet.stellar.org`, `horizon.stellar.org` |
| `src/config.ts` | `soroban-testnet.stellar.org`, `horizon-testnet.stellar.org`, `horizon.stellar.org` |

A stale constant is a live bug rather than a stale doc: the CLI and the MCP payer
dial these without the reader typing anything.

**2. Default drift is a warning, and a warning here is a silent demotion.** Today
a default that no longer matches emits `::warning::` and `continue`s
(`scripts/verify-doc-urls.mjs:132-134`). Gating is keyed on **host**, so editing
a default to a host outside `OWNED` takes it from "fails the build" to
"third-party, ignored" — with no decision made by anyone. That is the same class
of failure #515 exists to prevent, reached by editing one string.

**3. Test fixtures are probed.** `walk` (line 73) filters on extension only, so
every `https://res.test/paid` in the suite is enumerated and requested,
competing for a six-way concurrency pool with real endpoints. A fixture URL is
not a documented URL.

**4. The scan misses files.** `SCAN_DIRS` (line 36) stops at `scripts`: the
repo-root `README.md`, `docs/`, and `contrib/` are never read. The original
incident was doc rot.

### What this module adds

Everything that makes a network call is injected, so the policy is testable
without a socket — the difference between a check that gets exercised and one
that only runs when something is already broken.

- `SHIPPED_DEFAULTS` covers all 11 (verified: 0 drift against the tree today).
- `auditShippedDefaults` makes drift a **failure**, in two forms: the file no
  longer contains the expected URL, or the host is in neither `OWNED_HOSTS` nor
  the newly-declared `THIRD_PARTY_DEFAULT_HOSTS`. Being third-party is fine and
  stays a warning; being **undeclared** is not. The two lists answer different
  questions — "who do we operate" (gating) and "who do we ship a default for"
  (checked, not gated) — and conflating them is how Stellar's uptime ends up
  blocking an unrelated merge.
- `EXCLUDED_PATH` drops `*.test.ts`, `*.spec.ts`, `test/`, `tests/`,
  `__fixtures__/`, `__mocks__/`, and `*.d.ts`.
- `SCAN_TARGETS` adds `contrib`, `docs`, `README.md`, `CONTRIBUTING.md`.
- 402-as-success, the explorer `allow404`, the owned-host probe path, and
  "name the failing URL and its files" each have their own test.

### Integration into Core

1. **`scripts/verify-doc-urls.mjs`** — replace `SCAN_DIRS` (line 36),
   `CODE_DEFAULTS` (line 53) and the `CODE_DEFAULTS` loop (line 128) with
   `SCAN_TARGETS`, `SHIPPED_DEFAULTS` and `auditShippedDefaults`, and gate on
   `drift.length > 0` as well as `failures.length > 0`. Add
   `THIRD_PARTY_DEFAULT_HOSTS`.
2. **`scripts/verify-doc-urls.mjs:73`** — apply `isScannablePath` in `walk` so
   fixtures stop being dialled.
3. **Optionally** replace the body with `planChecks` / `buildReport` /
   `formatReport` from this module. No workflow change is needed —
   `verify-doc-urls.yml:39` already invokes the script on the right schedule
   with the right permissions, and no dependency is added.

### One thing left alone

`.github/workflows/hackathon-keepalive.yml` pings the same four hosts under a
stricter all-gating policy, with its `schedule:` block commented out. That is a
maintainer call about a hackathon deployment's lifetime, not a documentation
check, so this batch does not touch it. Worth noting that the host list is now
duplicated in three places, and `OWNED_HOSTS` is the one that should win.
