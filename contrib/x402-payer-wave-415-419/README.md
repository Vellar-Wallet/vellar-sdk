# x402 MCP Payer Wave Issues #415, #417, #418, #419

Contributor PRs may only touch `contrib/` (see `CONTRIBUTING.md` and the `close-prs-outside-contrib` bot). The four assigned issues pre-approve `packages/mcp-x402-payer/` and `src/` paths, but the bot does not read that exception — it closed previous contributor PRs like #465. This folder provides the complete, self-contained implementation and tests scoped strictly inside `contrib/` so the PR can stay open and be merged.

The core wiring that belongs in `packages/mcp-x402-payer/` and `src/` is also available on branch `feat/mcp-payer-preflight-timeout-diagnostics-breaker-415-417-418-419` (commit `1205546`) if a maintainer wants to cherry-pick or lift it into core.

```bash
npx vitest run contrib/x402-payer-wave-415-419
```

---

## #415 [hard] — Add a preflight self-check command to the MCP payer

Summary: Validates payer configuration, key validity, RPC connectivity, network matching, wallet contract existence, signer registration, and policy limits BEFORE making any payments.

- **Module**: [`preflight.ts`](./preflight.ts)
- **Tests**: [`preflight.test.ts`](./preflight.test.ts)
- **Features**:
  - Validates Ed25519 secret seed derivation and key validity.
  - Probes `rpcServer.getNetwork()` and matches against configured network passphrase (`Networks.TESTNET` / `Networks.PUBLIC`).
  - Probes `rpcServer.getContractInstance` for `walletAddress` and asserts key is registered on-chain via `kit.getSigner`.
  - Extracts policies required by `SignerLimits` and confirms all required contracts are in `VELLAR_X402_POLICIES` and exist on-chain.
  - Reports effective spend mode in exact words: `"chain-enforced (smart account policy)"` or `"process-only (hot wallet)"`.
  - Makes zero payments and signs no payment payloads.
  - Collects all distinct problems rather than aborting at the first.

**Lift**: wire `runPreflight` to `--preflight` / `preflight` flags in `packages/mcp-x402-payer/src/bin.ts`.

---

## #417 [medium] — Bound the MCP payer resource fetch with a timeout

Summary: Configurable timeout bounding outbound requests to untrusted sellers, preventing indefinite connection hangs from blocking the mutex.

- **Module**: [`payer-timeout.ts`](./payer-timeout.ts)
- **Tests**: [`payer-timeout.test.ts`](./payer-timeout.test.ts)
- **Features**:
  - `DEFAULT_REQUEST_TIMEOUT_MS = 25_000` (25 seconds, justified against `MIN_VIABLE_EXPIRATION_LEDGERS = 5` in `smart-account-scheme.ts` to safely cover ~12-15s / 2-3 ledgers worst-case settlement latency).
  - Configurable via `VELLAR_X402_REQUEST_TIMEOUT_MS` environment variable.
  - Applies to both initial unpaid request and paid retry.
  - Paid retry timeout triggers `ledger.debit` and throws `IndeterminateSettlementError` to prevent double payment and preserve spending ceiling (audit V-2).

**Lift**: import `DEFAULT_REQUEST_TIMEOUT_MS`, `parseRequestTimeoutMs`, and timeout handler into `packages/mcp-x402-payer/src/config.ts` and `payer.ts`.

---

## #418 [medium] — Emit structured startup diagnostics as a machine-readable line

Summary: Declared, versioned startup event emitted by the MCP payer upon readiness, allowing operators to monitor spend mode and detect schema updates.

- **Module**: [`startup-diagnostics.ts`](./startup-diagnostics.ts)
- **Tests**: [`startup-diagnostics.test.ts`](./startup-diagnostics.test.ts)
- **Features**:
  - Exported `StartupDiagnosticEvent` TypeScript interface (`schemaVersion: 1`, `network`, `payer`, `assets`, `spendLimit`, optional `policies`).
  - Distinguishes `"chain-enforced (smart account policy)"` from `"process-only (hot wallet)"`.
  - Guaranteed zero secret leakage; secret redaction leaves diagnostic line unchanged.

**Lift**: import `createStartupDiagnosticEvent` and `StartupDiagnosticEvent` into `packages/mcp-x402-payer/src/output.ts` and `bin.ts`.

---

## #419 [medium] — Add a facilitator health probe to the x402 client

Summary: Applies the existing wallet circuit breaker (`createCircuitBreaker` from `src/circuit-breaker.ts`) to the x402 payment path.

- **Module**: [`facilitator-health-probe.ts`](./facilitator-health-probe.ts)
- **Tests**: [`facilitator-health-probe.test.ts`](./facilitator-health-probe.test.ts)
- **Features**:
  - Reuses `createCircuitBreaker` without parallel mechanisms.
  - Deliberate failure criteria: HTTP 402 challenges and `PaymentRejectedError` (deterministic policy refusals) do NOT count as failures. Only transport errors and HTTP 5xx responses trip the breaker.
  - Fast-fails with `CircuitOpenError` confirming: `"The vellar-facilitator circuit is open (downstream outage); call refused. No payment was attempted and nothing was spent."`

**Lift**: integrate `withX402CircuitBreaker` / options into `createX402Client` in `src/x402-client.ts`.
