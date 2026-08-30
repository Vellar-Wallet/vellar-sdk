# x402 Payment Completion Telemetry

Self-contained reference for issue [#296](https://github.com/Vellar-Wallet/vellar-sdk/issues/296): emitting an optional telemetry event when an x402 payment completes.

## Run tests

```bash
npx vitest run contrib/examples/issue-296-x402-payment-telemetry
```

## Why

`wallet.x402.fetch()` resolves with `{ response, paid, settlement }` and that is the end of it. A host that wants to know how much its agents are spending, on what, and how often, has to instrument every call site by hand. That is the gap in consumer usage insight #296 describes.

This adds one event — `x402.payment.completed` — emitted once per payment that actually settled.

## Usage

```ts
import { withPaymentTelemetry } from "./x402-telemetry";

const wallet = createVellarWallet({ /* ... */ });

wallet.x402.fetch = withPaymentTelemetry(wallet.x402.fetch, {
  sink: (event) => analytics.track(event.type, toJSON(event)),
  onError: (err) => console.warn("x402 telemetry sink failed", err),
});

// Unchanged from the caller's perspective:
const { response, settlement } = await wallet.x402.fetch(url, { maxAmount: 5_000_000n });
```

Omit `sink` and `withPaymentTelemetry` returns the original function untouched — telemetry is entirely opt-in, with no per-call cost when it's off.

## The event

```ts
{
  type: "x402.payment.completed",
  resourceId: "https://api.test/v1/report",  // the issue's "resource id"
  amount: 1000000n,                          // the issue's "amount", base units
  asset: "CBIN4HTP…",                        // SEP-41 asset contract
  network: "testnet",
  transaction: "1f0a6c62…",                  // on-chain settlement hash
  payer: "CAAAA…",                           // payer C-address
  status: 200,                               // unlocked resource response
  timestamp: 1700000000000,
  durationMs: 250,                           // when measured
}
```

`resourceId` and `amount` are the two properties the issue asks for; the rest is what makes an event reconcilable against chain rather than merely countable.

## Design rules

### Telemetry must never break a payment

A payment that reaches this event has already moved real money on-chain. If the sink throws, rejects, or hangs, the caller still gets their `X402Response`. There is no configuration that lets telemetry fail a settled payment.

Covered explicitly by tests: a synchronous throw, a rejected async sink, an `onError` that itself throws, and a sink that never resolves. The promise from an async sink is deliberately **not awaited** — a slow analytics call must not add latency to a payment that already settled — so its rejection is caught internally rather than surfacing as an unhandled rejection (also tested).

### It must not leak secrets

The event carries no request headers and no bodies. `PAYMENT-SIGNATURE` is a signed authorization, and the SDK already treats leaking it as a security bug — see [`packages/mcp-x402-payer/src/output.ts`](../../../packages/mcp-x402-payer/src/output.ts).

URLs are stripped of query and fragment by default, because API keys live in query strings:

| `resourceIdMode` | `https://api.test/v1/r?apiKey=secret` becomes |
| --- | --- |
| `"path"` (default) | `https://api.test/v1/r` |
| `"origin"` | `https://api.test` |
| `"full"` | unchanged — opt-in, only when you control the URLs |

A URL that fails to parse still has its query and fragment cut off lexically. An unparseable URL is not a reason to log a raw secret.

### Amounts stay exact

Base-unit amounts are `bigint` throughout the SDK, and a stroop-precision value can exceed `Number.MAX_SAFE_INTEGER`. The event keeps the `bigint`.

Because `JSON.stringify` throws on a `bigint`, `toJSON(event)` renders `amount` as a decimal string — exact, and round-trippable via `BigInt(...)`. Both the throw and the round-trip are tested, since a sink that serializes is the common case.

### Only real payments count

A resource that returned no 402 resolves with `paid: false`. That is a cache hit, not a payment, and emitting it would inflate every "payments made" metric built on this event. Nothing is emitted unless `paid` is true **and** a settlement is present. A failed payment emits nothing and rethrows untouched.

## Semantics

| Case | Result |
|------|--------|
| Payment settles | One event, after the result is in hand |
| Resource needed no payment (`paid: false`) | No event |
| `paid: true` but no settlement header | No event |
| The fetch itself throws | No event; the error propagates unchanged |
| Sink throws or rejects | Result still returned; `onError` called |
| `onError` throws | Swallowed — the payment stays intact |
| Sink is slow | Not awaited; adds no latency |
| No `sink` configured | Original fetch returned as-is |

## Aggregating spend

`createMemorySink()` accumulates events and totals spend per asset — useful in tests, and as a spend-report source for a short-lived agent session:

```ts
const { sink, events, totalFor } = createMemorySink();
wallet.x402.fetch = withPaymentTelemetry(wallet.x402.fetch, { sink });
// ...
totalFor(USDC_CONTRACT); // => 2000000n
```

For enforcing a budget rather than observing one, use the chain-enforced path instead — [`src/x402-budget-attributes.ts`](../../../src/x402-budget-attributes.ts) and the session-key ceiling in [`packages/mcp-x402-payer/src/ledger.ts`](../../../packages/mcp-x402-payer/src/ledger.ts). Telemetry is for insight; it is not a spending control, because a sink that fails must never block a payment.

## Documentation note

The issue asks for the event to be documented in the README's observability section. `README.md` sits outside `contrib/`, which contributor PRs may not touch, so the reference documentation lives in this file instead — the tables above are written to be lifted into that section verbatim when the event moves into `src/x402-client.ts`.

## Moving this into the SDK

`withPaymentTelemetry` wraps the public `fetch`, so it works today without SDK changes. Emitting from inside `src/x402-client.ts` would be a small change: the completion point is where `readSettlement()` returns and `x402Fetch` resolves `{ response: paid, paid: true, settlement }`. Adding an optional `telemetry?: X402TelemetryOptions` to `X402ClientDeps` (threaded through `X402FacadeDeps.config`, alongside `budgetAttributes`) and calling `buildPaymentCompletedEvent` there would emit the same event for every caller, including those who never touch the facade.

## Limits

One event type. No batching, sampling, or retry — a sink that wants those should implement them, since the right policy depends on the backend. `durationMs` measures the whole `fetch` call including the unpaid first request and the signing round-trip, not just the settlement.
