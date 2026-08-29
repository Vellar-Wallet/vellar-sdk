# Wallet health check aggregator

`runHealthAggregator()` runs three distinct mock health checks against a
wallet and reports an overall status:

1. **Session valid** — a session exists, is `connected`, and its
   `expiresAt` is in the future (relative to the given "now").
2. **Backend reachable** — a caller-supplied `pingBackend()` resolves
   `true` (a `false` result and a thrown error are both reported as
   distinct reasons).
3. **RPC reachable** — same shape as the backend check, for a separate
   `pingRpc()` — a wallet's server backend and its Soroban RPC node are
   independent dependencies that can fail separately.

## Overall status

The overall status is **`"degraded"` if any single check fails** — there is
no partial-credit state. It's only `"healthy"` when all three checks pass.

## Usage

```ts
import { runHealthAggregator, formatReport } from "./wallet-health-aggregator";

const report = await runHealthAggregator({
  session: { connected: true, expiresAt: "2026-07-01T00:00:00.000Z" },
  pingBackend: () => fetch("/health").then((r) => r.ok),
  pingRpc: () => fetch(rpcUrl).then((r) => r.ok),
});

console.log(formatReport(report)); // "Overall status: HEALTHY" / "DEGRADED"
```

## Run it

```sh
npx tsx wallet-health-aggregator.ts
```

Runs the aggregator twice: once with every check passing, once with the RPC
check deliberately failing.

Expected output:

```
Run 1: all checks passing

Overall status: HEALTHY

  ✓ Session valid
  ✓ Backend reachable
  ✓ RPC reachable


Run 2: RPC check deliberately failing

Overall status: DEGRADED

  ✓ Session valid
  ✓ Backend reachable
  ✗ RPC reachable — RPC ping returned false
```

## Tests

```sh
npx vitest run contrib/examples/wallet-health-aggregator
```
