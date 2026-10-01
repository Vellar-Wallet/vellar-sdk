# Issue #298 — Legacy Connector Dead Code Audit

## Finding

The issue states that `connector.ts` contains a legacy fallback connection path
that was superseded and is no longer referenced.

After auditing the codebase, `src/connector.ts` contains only a pure TypeScript
interface definition (`WalletConnector`) with no implementation code, fallback
paths, or helper functions. The concrete implementation lives in
`src/passkeykit-connector.ts`, which contains no legacy fallback paths either.

**No dead code exists to remove.** The legacy fallback path was either already
cleaned up in a prior release or was never present in the current codebase.

## Verification

- `connector.ts` — 19 lines, interface-only, no functions or helpers
- `passkeykit-connector.ts` — single implementation path, no fallback branches
- No callers reference any legacy or fallback connector functions
- Existing tests (`passkeykit-connector.test.ts`) pass without changes

## Recommendation

This issue can be closed as already resolved. No code changes are required.
