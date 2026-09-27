# x402 Wave issues #403, #406, #413, #414

Contributor PRs may only touch files inside `contrib/` (see `CONTRIBUTING.md` and the `close-prs-outside-contrib` bot). Although the assigned issue descriptions note pre-approved core paths, the automated bot closes any pull request touching files outside `contrib/`. This folder contains the complete, production-ready implementations and tests for issues #403, #406, #413, and #414, scoped strictly within `contrib/` so the PR stays open.

To run tests:
```bash
npx vitest run contrib/x402-wave-403-414
```

---

## #406 — Enforce the exports allowlist in export-surface.ts with a test

### Implementation
- `contrib/x402-wave-403-414/export-surface.test.ts`

### Behavior
- Compares actual public exports from `src/v1-exports.ts` and `src/experimental-exports.ts` against declared `STABLE_V1_EXPORTS` and `EXPERIMENTAL_EXPORTS` in `src/export-surface.ts`.
- Fails with a readable diff listing missing and extra exports if the public export surface drifts.
- Includes architectural rationale comments arguing why extra exports present in code but absent from allowlists must fail.

### Lift to Core
- Copy `export-surface.test.ts` directly into `src/export-surface.test.ts`.

---

## #403 — Shared-state adapter for the x402 budget attribute tracker

### Implementation
- `contrib/x402-wave-403-414/x402-budget-attributes-shared.ts`
- `contrib/x402-wave-403-414/x402-budget-attributes-shared.test.ts`

### Behavior
- Defines `BudgetAttributeStore` (`getItem`/`setItem`) and `createSharedStateBudgetAttributeTracker(store, options)`.
- Serializes check-then-record sequences using an async mutex (`runExclusively`), ensuring parallel payments against a rule with limited remaining period budget are handled atomically.
- Throws `BudgetAttributeStoreUnavailableError` and fails CLOSED (refuses payment) if the underlying store throws or is unavailable.

### Lift to Core
- Re-export `BudgetAttributeStore`, `BudgetAttributeStoreUnavailableError`, and `createSharedStateBudgetAttributeTracker` from `src/x402-budget-attributes.ts`.
- Update module header in `src/x402-budget-attributes.ts` to document fail-closed store error behavior.

---

## #413 — `--dry-run` flag for `vellar pay`

### Implementation
- `contrib/x402-wave-403-414/cli-dry-run.ts`
- `contrib/x402-wave-403-414/cli-dry-run.test.ts`

### Behavior
- Implements `--dry-run` option support for `vellar pay`.
- Executes full validation, challenge decoding, ceiling check, fee sponsorship check, and payload creation/signing.
- Stops before sending the paid HTTP request.
- Outputs payer, asset, amount, recipient (payTo), and signature expiration ledger, with explicit disclaimer that verification happens server-side.

### Lift to Core
- Wire `--dry-run` option into `makePayCommand` in `packages/cli/src/commands/pay.ts` and update `packages/cli/src/commands/pay.test.ts`.

---

## #414 — Persist the MCP payer spend ledger across restarts

### Implementation
- `contrib/x402-wave-403-414/durable-mcp-ledger.ts`
- `contrib/x402-wave-403-414/durable-mcp-ledger.test.ts`

### Behavior
- Defines `DurableLedgerStore` interface, `createFileLedgerStore`, and `createDurableSpendLedger`.
- Parses `VELLAR_X402_LEDGER_FILE` environment variable for file-backed persistence across restarts.
- Fails CLOSED by throwing `DurableLedgerStoreError` if loading or saving spend state fails.
- Reports active persistence mode at startup (`durable (<path>)` vs `in-memory (resets on restart)`).

### Lift to Core
- Move `DurableLedgerStore`, `createFileLedgerStore`, and `createDurableSpendLedger` into `packages/mcp-x402-payer/src/ledger.ts`.
- Add `ledgerFile` to `PayerConfig` in `packages/mcp-x402-payer/src/config.ts` and initialize in `packages/mcp-x402-payer/src/bin.ts`.
