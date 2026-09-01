# Jittered retry delay for tx-status polling

Adds randomized jitter to the polling delay in
[`waitForTransaction`](../../../src/tx-status.ts), which currently sleeps a
fixed `intervalMs` between every poll.

Contributed for [issue #280](https://github.com/Vellar-Wallet/vellar-sdk/issues/280).

## Why

`waitForTransaction` polls a `TxStatusReader` on a fixed interval until the
transaction reaches a final state. That's fine for a single caller, but a
fleet of independent processes that all start polling around the same
moment — e.g. many workers submitting transactions right after a deploy —
end up polling in lockstep: every instance sleeps for exactly the same
duration and then hits the RPC endpoint again at the same instant, in
bursts, rather than being spread out over time.

This is the same failure mode retry jitter is normally applied to for
*exponential* backoff (see this repo's own
[`exponential-backoff`](../exponential-backoff/) example, and the AWS
Architecture Blog's "Exponential Backoff And Jitter"), except here the base
delay is a fixed poll interval rather than a growing backoff. The same fix
applies: instead of sleeping for exactly `intervalMs`, sleep for a random
delay drawn from a range around it.

## The approach

`computeJitteredDelay(intervalMs, options)` implements **full jitter**: each
delay is drawn uniformly from `[0, intervalMs * (1 + jitterFactor)]`, then
capped at `maxDelayMs`.

- `jitterFactor` (default `0.5`) controls how wide that range is relative to
  the base interval. `0` degrades to no randomization.
- `maxDelayMs` (default `intervalMs * 10`) is a hard ceiling on any single
  delay, so a large `jitterFactor` can't produce unbounded waits — this is
  the "configurable bound" the issue asks for.
- `random` is injectable (defaults to `Math.random`), so tests can assert
  exact values instead of ranges.

`waitForTransactionJittered` is a drop-in replacement for
`waitForTransaction` with the same contract — same `TxStatus`/`TxStatusReader`
types (re-exported from `src/tx-status.ts`), same
`TransactionTimeoutError` on timeout — except the sleep between polls comes
from `computeJitteredDelay` instead of a fixed `intervalMs`. The timeout
deadline check accounts for the jittered delay actually used, so a run of
unlucky (large) jittered delays still respects `timeoutMs`.

## Usage

```ts
import { waitForTransactionJittered } from "./tx-status-jitter";
import { createRpcTxStatusReader } from "vellar-sdk/rpc";

const reader = createRpcTxStatusReader({ rpcUrl: "https://soroban-rpc.example" });

const result = await waitForTransactionJittered(reader, txHash, {
  intervalMs: 2000,
  jitterFactor: 0.5, // delays drawn from [0ms, 3000ms]
  maxDelayMs: 5000,  // never sleep longer than this regardless of jitterFactor
});
```

## Run it

```sh
npx tsx tx-status-jitter.ts
```

Polls a mock reader that goes pending three times before succeeding, and
prints the actual (jittered, non-uniform) delays used between polls.

## Tests

```sh
npx vitest run contrib/examples/issue-280-tx-status-retry-jitter
```

Covers `computeJitteredDelay` directly (produces a distribution rather than
one fixed value, stays within `[0, intervalMs * (1 + jitterFactor)]`, is
deterministic given an injected `random`, respects `maxDelayMs` even with an
extreme `jitterFactor`, defaults `maxDelayMs` to `10x intervalMs`, and
rejects negative inputs), and `waitForTransactionJittered` end to end
(resolves on success/failure, times out correctly even under worst-case
jitter, propagates reader errors, uses varying rather than fixed delays
across polls, and never exceeds a configured `maxDelayMs`).
