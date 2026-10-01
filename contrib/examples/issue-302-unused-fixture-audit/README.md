# Unused Fixture Audit

Self-contained reference for issue [#302](https://github.com/Vellar-Wallet/vellar-sdk/issues/302): confirming which exports of `src/x402-test-fixtures.ts` are still referenced, and which imports of it are dead.

## Run tests

```bash
npx vitest run contrib/examples/issue-302-unused-fixture-audit
```

## Outcome: there are no unused fixtures to remove

Issue #302 asks to remove "several fixtures that are no longer referenced by any current test file". Its first requirement is to **confirm each fixture has no remaining references** — and on this branch, that confirmation comes back negative: **every export in `src/x402-test-fixtures.ts` is still referenced by a live test.** There is nothing to delete.

The audit below is produced by `formatAuditReport()` in this module, run against the real files:

| Export | Kind | References | Used by |
| --- | --- | ---: | --- |
| `C_ADDRESS` | const | 2 | src/x402-client.test.ts, contrib/x402-client-fallback.test.ts |
| `TOKEN` | const | 13 | src/x402-client.test.ts, src/x402-guards.test.ts, contrib/x402-guards-boundary.test.ts |
| `PAYTO` | const | 4 | src/x402-client.test.ts |
| `SIM_SOURCE` | const | 13 | src/x402-client.test.ts, contrib/x402-client-fallback.test.ts |
| `CAIP2_TESTNET` | const | 31 | src/x402-guards.test.ts, contrib/x402-guards-boundary.test.ts |
| `b64` | function | 11 | src/x402-guards.test.ts, contrib/x402-guards-boundary.test.ts |
| `requirements` | function | 56 | src/x402-client.test.ts, src/x402-guards.test.ts, contrib/x402-client-fallback.test.ts, contrib/x402-guards-boundary.test.ts |
| `decoded` | function | 34 | src/x402-guards.test.ts, contrib/x402-guards-boundary.test.ts |
| `response402` | function | 13 | src/x402-client.test.ts, src/x402-guards.test.ts, contrib/x402-client-fallback.test.ts, contrib/x402-guards-boundary.test.ts |

Reference counts **exclude the import line itself**, so every number above is a genuine use in a test body.

`PAYTO` is worth calling out: it is the one export used by a single consumer, and on `main` it genuinely was imported by nobody. Tests added to `dev` since then use it, which is precisely why the audit is worth re-running rather than trusting a stale answer.

### What the audit did find

One real cleanup, applied in this PR:

```
Dead imports in contrib/x402-client-fallback.test.ts: `requirements`, `response402`
```

Both names were imported and never used. That is a dead *import*, not an unused *export* — the fixtures themselves are used elsewhere — so the fix is to shorten the import, not to delete the fixtures. Done in [`contrib/x402-client-fallback.test.ts`](../../x402-client-fallback.test.ts).

## Why a tool instead of a grep

A bare `grep -c NAME` gives the wrong answer here, in three separate ways:

1. **It counts the import line.** A fixture that is imported and never used still looks used. This is exactly the `contrib/x402-client-fallback.test.ts` case above — grep reports `requirements` as referenced when it isn't.
2. **It counts unrelated local declarations.** `PAYTO` is independently declared in `src/x402-auth-entry.test.ts`, `packages/mcp-x402-payer/test/helpers.ts`, and others. Grepping the repo for `PAYTO` returns 13 hits that have nothing to do with the fixture module.
3. **It cannot distinguish an unused export from a dead import.** The two have different fixes — delete the export vs. shorten the import — and conflating them leads to deleting a fixture that another file still needs.

`auditFixtures()` resolves all three by parsing each consumer's fixture import statement, then counting whole-word references in that consumer's body with the fixture import line removed.

## Usage

```ts
import { readFileSync } from "node:fs";
import { auditFixtures, formatAuditReport } from "./fixture-audit";

const result = auditFixtures({
  fixtureSource: readFileSync("src/x402-test-fixtures.ts", "utf8"),
  moduleId: "x402-test-fixtures",
  consumers: ["src/x402-client.test.ts", "src/x402-guards.test.ts"].map((file) => ({
    file,
    source: readFileSync(file, "utf8"),
  })),
});

result.unusedExports; // [] — safe to delete, were there any
result.deadImports;   // [{ file, names }] — imported but never referenced
console.log(formatAuditReport(result));
```

## Semantics

| Case | Result |
|------|--------|
| Export imported and referenced by a consumer | Used |
| Export imported by a consumer but never referenced | Unused export **and** a dead import for that file |
| Export referenced only inside the fixture module itself | Unused — internal use doesn't justify an `export` |
| Export referenced by at least one of several consumers | Used; still a dead import in the files that don't use it |
| A name declared locally in a file that doesn't import the module | Ignored — the file isn't a consumer |
| Longer identifier containing the name (`TOKEN` vs `TOKEN_LIST`) | Not counted; matching is whole-word |
| Aliased import (`TOKEN as ASSET`) | Counts references to the local name (`ASSET`) |

## Guarding against regression

The final `describe` block in the test file runs the audit against the real repository files on every `npm test`. If a future change orphans a fixture, `reports NO unused exports` fails and names it — turning "is this still used?" from a manual grep into a standing check, and flagging the moment the removal #302 asked for actually becomes correct.

## Limits

Line-oriented parsing, no TypeScript AST. It handles the syntax these fixtures actually use — single-line named imports, `as` aliases, inline `type` modifiers — and deliberately does not attempt multi-line import blocks for the *fixture* module, `import * as ns`, or re-exports. A name referenced only inside a comment or string literal counts as a reference. For this fixture module and its four consumers that is sufficient; for a general-purpose dead-code pass, use a tool built on the compiler API such as `knip` or `ts-prune`.
