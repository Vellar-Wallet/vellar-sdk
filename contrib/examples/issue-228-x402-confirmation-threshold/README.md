# x402 Confirmation Threshold

Self-contained reference for issue [#228](https://github.com/Vellar-Wallet/vellar-sdk/issues/228): an explicit confirmation step for high-value x402 payments, above and beyond the standing `maxAmount` budget check.

## Run tests

```bash
npx vitest run contrib/examples/issue-228-x402-confirmation-threshold
```

## Why

`X402PayOptions.maxAmount` is a client-side hard ceiling, and the durable budget is the on-chain spending-limit policy — but neither is a per-payment "ask before this one" gate. A caller who wants to auto-pay small amounts but require an explicit go-ahead above some threshold (e.g. an agent that should ask a human before spending more than $1) has no seam for that today.

## Usage

```ts
import { withConfirmationThreshold } from "./confirmation-threshold";
import { CAIP2_BY_NETWORK } from "vellar-sdk/x402-guards";

const guardedClient = withConfirmationThreshold(wallet.x402, {
  confirmationThreshold: 5_000_000n, // 0.5 XLM, in stroops
  ourCaip2: CAIP2_BY_NETWORK[network], // "stellar:testnet" | "stellar:pubnet"
  async confirm({ amount, asset }) {
    return await promptUser(`Approve payment of ${amount} ${asset}?`);
  },
});

// Below the threshold — signs immediately, confirm() never called.
await guardedClient.fetch("https://api.example.com/cheap", { maxAmount: 10_000_000n });

// At/above the threshold — blocks on confirm() before signing.
await guardedClient.fetch("https://api.example.com/expensive", { maxAmount: 10_000_000n });
```

## Semantics

| Case | Result |
|------|--------|
| Amount below threshold | Delegates immediately; `confirm` is never called |
| Amount at/above threshold, `confirm` resolves `true` | Delegates once `confirm` settles |
| Amount at/above threshold, `confirm` resolves `false` | `PaymentNotConfirmedError` — nothing signed |
| `createPayment` | Amount read straight off `requirements.amount` |
| `fetch` | See "Limits" below |

## Limits

`X402Client.fetch(url, init)` decodes the 402 and retries with the signed payment inside one call — nothing about the amount is observable from outside until it's already about to sign. This wrapper's `fetch` does its own preliminary request to see the 402 and decode which option would be picked (via the SDK's public `x402-guards` exports — `decodePaymentRequired` / `selectRequirements` / `parseAmount`, not internals), then either delegates immediately or after `confirm` resolves.

That means a payment gated through `fetch` costs **two** round-trips to the 402 challenge instead of one: the wrapper's own probe, then the wrapped client's real fetch → 402 → sign → retry flow. This is the real cost of adding a confirmation gate from *outside* `createX402Client` rather than inside it — building it inside `src/x402-client.ts` (where the 402 is already decoded once) would avoid the extra round-trip, at the cost of `src/`-level changes I could not make. If that overhead matters for your case, gate at the `createPayment` call site instead (where the amount is already known with no extra request), or ask a maintainer to fold this into `createX402Client` directly.

This is a client-side UX gate, not a security boundary — same caveat as `maxAmount` itself: it's only as trustworthy as the code calling it.
