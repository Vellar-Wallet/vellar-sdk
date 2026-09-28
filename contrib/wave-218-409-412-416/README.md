# Wave Issues #218, #409, #412, #416

Contributor PRs may only touch `contrib/` (see `CONTRIBUTING.md` and the `close-prs-outside-contrib` bot).
The assigned issues approve `src/`, `packages/cli/`, and `packages/mcp-x402-payer/` paths, but the bot does not read exceptions — it auto-closes PRs touching anything outside `contrib/` (e.g. [#465](https://github.com/Vellar-Wallet/vellar-sdk/pull/465) and [#483](https://github.com/Vellar-Wallet/vellar-sdk/pull/483)).

This folder provides reference implementations, standalone wrappers, validation contracts, and unit tests scoped so a contributor PR can stay open and be merged by maintainers.

> **Direct core implementation branch:** The complete wiring applied directly to `src/`, `packages/cli/`, and `packages/mcp-x402-payer/` is also available on the fork branch `feat/wave-218-409-412-416` (commit `aa7053d`) if maintainers prefer to cherry-pick it directly.

```bash
npx vitest run contrib/wave-218-409-412-416
```

---

## #218 — Fallback RPC endpoint routing for tx-rpc read-heavy calls

### Behavior (`contrib/wave-218-409-412-416/fallback-rpc.ts`)
- **`RpcTxStatusReaderOptions`**: Supports `rpcUrl`, optional `fallbackRpcUrls: string[]`, and optional `timeoutMs: number`.
- **Sequential Failover**: Queries the primary RPC endpoint first. On timeout or error, it catches the error and traverses the fallback endpoints in priority order.
- **Fail-safe**: Only throws if all configured RPC endpoints (primary + all fallbacks) fail.

### Lift into Core
1. Merge `RpcTxStatusReaderOptions` into `src/tx-rpc.ts`.
2. Update `createRpcTxStatusReader` in `src/tx-rpc.ts` with the sequential failover loop and timeout wrapping.
3. Move `contrib/wave-218-409-412-416/fallback-rpc.test.ts` into `src/tx-rpc.test.ts`.
4. Document multi-endpoint configuration in root `README.md`.

---

## #409 — Invalidate session on network mismatch during restore

### Behavior (`contrib/wave-218-409-412-416/session-network-guard.ts`)
- **Network Verification**: When `restore()` loads a persisted session, it checks whether `session.network === expectedNetwork`.
- **Discard & Evict**: If the network diverges from `expectedNetwork`, the session is rejected, `storage.clear()` is called to evict stale state from disk/storage, and the store transitions to `status: "disconnected"`.
- **Observability**: Sets `disconnectReason: "network_mismatch"` and triggers the optional `onSessionMismatch({ session, expectedNetwork })` callback.

### Lift into Core
1. Add `expectedNetwork?: Network` and `onSessionMismatch?: (event: SessionMismatchEvent) => void` to `CreateSessionStoreOptions` in `src/session.ts`.
2. Add `disconnectReason?: DisconnectReason | null` to `SessionState` in `src/session.ts`.
3. Check `stored.network !== options.expectedNetwork` inside `restore()` in `src/session.ts`.
4. Port unit tests from `session-network-guard.test.ts` into `src/session.test.ts`.

---

## #412 — CLI pay settlement retry semantics & exit codes

### Behavior (`contrib/wave-218-409-412-416/cli-settlement.ts`)
- **`classifySettlement` Integration**: Inspects the response settlement state:
  - `settled`: Exit code `0`. Payment confirmed on-chain.
  - `not-spent`: Exit code `3`. Facilitator refused or failed before submission; safe to retry immediately.
  - `indeterminate`: Exit code `5`. Unverified settlement status or post-submission failure.
- **Operator Guidance**: On indeterminate outcomes, logs clear operator instructions including transaction hash (if present) and instructions to verify on Horizon / Stellar Expert before retrying to prevent double-spending.

### Lift into Core
1. Import `classifySettlement` from `vellar-sdk/x402-guards` inside `packages/cli/src/commands/pay.ts`.
2. Classify response after payment and exit with `0`, `3`, or `5` according to outcome kind.
3. Document retry semantics in `packages/cli/README.md`.
4. Move test assertions from `cli-settlement.test.ts` into `packages/cli/src/commands/pay.test.ts`.

---

## #416 — MCP stdout diversion secret leak prevention

### Behavior (`contrib/wave-218-409-412-416/secret-diversion.ts`)
- **Verification**: Confirmed that `divertStdoutToStderr` in `packages/mcp-x402-payer/src/output.ts` wraps all intercepted chunks in `redact(...)` before writing to `process.stderr`.
- **Pattern Matching**: Ensures both explicitly registered secrets (`registerSecret`) and unregistered Stellar secret seed shapes (`\bS[A-Z2-7]{55}\b`) are redacted to `[REDACTED]`.
- **Unit Tests**: Full test suite verifying that redirected stdout chunks cannot leak secret seeds or keys to stderr.

### Lift into Core
1. Port tests from `contrib/wave-218-409-412-416/secret-diversion.test.ts` into `packages/mcp-x402-payer/test/secret-leak.test.ts`.
