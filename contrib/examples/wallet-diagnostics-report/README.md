# Wallet diagnostics report

Runs four distinct mock diagnostic checks against a real `VellarWallet`
handle and prints a combined report that clearly separates passing checks
from failing ones, with a reason for each failure:

1. **Session exists** — `wallet.session` is non-null.
2. **Session connected** — `wallet.session.connected` is `true`.
3. **Network matches expected** — `wallet.session.network` equals the
   network the caller expected.
4. **Backend reachable** — a caller-supplied `pingBackend()` resolves
   `true` (a failed ping, a `false` result, and a thrown error are all
   reported as distinct reasons).

## Usage

```ts
import { runDiagnostics, formatReport } from "./wallet-diagnostics-report";

const report = await runDiagnostics({
  wallet,
  expectedNetwork: "testnet",
  pingBackend: () => fetch("/health").then((r) => r.ok),
});

console.log(formatReport(report));
```

## Run it

```sh
npx tsx wallet-diagnostics-report.ts
```

Expected output (before `create()`, the session-dependent checks fail; after,
everything passes):

```
Report before connecting (session checks should fail):

Diagnostics: 1/4 passed

Passing:
  ✓ Backend reachable

Failing:
  ✗ Session exists — No active session — call create() or connect() first
  ✗ Session connected — Session exists but is not marked connected
  ✗ Network matches expected — No session to check the network against


Report after connecting (everything should pass):

Diagnostics: 4/4 passed

Passing:
  ✓ Session exists
  ✓ Session connected
  ✓ Network matches expected
  ✓ Backend reachable
```

## Tests

```sh
npx vitest run contrib/examples/wallet-diagnostics-report
```
