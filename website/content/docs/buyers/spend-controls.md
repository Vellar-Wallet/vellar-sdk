# Spend Controls

> There are two independent spend controls on every Vellar x402 payment — a
> client-side guard and an on-chain enforced budget. They are different things
> and it matters which you rely on.

By the end of this page you will understand the difference between `maxAmount`
and the spending-limit policy, know how to scope a budget to a specific token,
and understand the two-signer options for agent versus human payments.

## The two controls

| Control | Where enforced | Trustworthy as | Use for |
|---|---|---|---|
| `maxAmount` | Client-side, before signing | The client process | Preventing accidental overpayment |
| Spending-limit policy | On-chain, inside `__check_auth` | Consensus — cannot be bypassed | The real agent budget |

> ⚠️ **maxAmount is not the budget.** It refuses to sign a payment above the
> ceiling, but it is only as trustworthy as the client process — a compromised
> or buggy agent can ignore it. The spending-limit policy is enforced by the
> network, so even a fully compromised agent cannot exceed it.

## Setting maxAmount

```ts
const { response, paid, settlement } = await vellar.x402.fetch(
  "https://api.example.com/paid",
  {
    maxAmount: 1_000_000n, // hard per-request ceiling, in the asset's base units
  },
);
```

The SDK refuses to *sign* a payment whose required amount exceeds this ceiling,
guarding against an over-charging or misconfigured server. Nothing is signed and
nothing is spent when it trips — you get a `MaxAmountExceededError`.

> **Note:** Amounts are `bigint` values in the asset's base units, never
> floating-point. Stellar Asset Contracts use 7 decimals, so `1_000_000n` is 0.1
> units and `10_000_000n` is 1.0. Check the asset's own `decimals` rather than
> assuming, and never use floating-point math on an amount.

## The on-chain spending-limit policy

The spending-limit policy runs inside the wallet's `__check_auth` and caps
cumulative spend per fixed window. The agent session key is attached with
`SignerLimits` that require the policy to co-sign any transfer, so the chain
refuses to move funds beyond the cap even if client code is bypassed.

The window is **fixed (tumbling), not sliding** — spent resets to zero when the
window elapses. Spending timed around a window boundary can therefore move up to
**2× the cap** in a short span. Treat the limit as an on-chain spending
guardrail, not a to-the-stroop hard cap; see
[Honesty](../reference/honesty.md) for the full explanation.

> **Note:** The spending-limit policy validates the token and the amount. It has
> no opinion on the recipient. A payment redirected to a different address
> within the cap satisfies the policy. Guarding the recipient is your
> application's responsibility.

Use a **token-scoped** spending-limit policy so only one specific token's
transfers count against the budget — then "give your agent $10/day of USDC"
means exactly that: USDC only, capped, on-chain.

```ts
// 1. Generate the deployable artifacts for a spending-limit definition.
const policy = await vellar.policies.generate({
  version: "1",
  type: "spending_limit",
  owners: [vellar.session!.accountId],
  spendingLimits: { dailyXlm: "100" }, // 100 XLM per 24h fixed window
});

// 2. Attach it to the wallet — the ONLY passkey prompt in this flow.
const { contractId, attachTxHash } = await vellar.policies.deploy(policy.id);
```

See [Policies & provenance](../agent-tooling/policies.md) for the full authoring flow,
including `listTemplates()` and the optional `simulate()` dry run.

## The two signers

| Signer | Flow | Use for |
|---|---|---|
| `createSessionKeySigner({ address, secretKey })` | Agent — signs headlessly, no passkey prompt | Autonomous agents running unattended |
| `createPasskeyX402Signer({ address, webAuthn })` | Human — one passkey prompt per payment | Human-initiated payments from a web app |

> ⚠️ **The passkey signer does not settle today.** `createPasskeyX402Signer`
> produces a correct signature shape, but no deployed facilitator currently
> accepts human passkey-signed x402 payments. Build on `createSessionKeySigner`
> for any flow that needs to actually settle. This applies especially to
> [hackathon](../hackathon.md) projects.

## allowedAssets

Restrict which assets the agent will pay in. If the seller offers no asset in
your list, the payment is refused before signing:

```ts
const { response } = await vellar.x402.fetch(
  "https://api.example.com/resource",
  {
    maxAmount: 1_000_000n,
    allowedAssets: [usdcContractId],
  }
);
```

If omitted, the SDK accepts any asset the seller offers that matches the scheme
and network.

## When it fails

| Error | Cause | Fix |
|---|---|---|
| `MaxAmountExceededError` | Server asked for more than maxAmount | Raise maxAmount or choose a cheaper resource. Nothing was signed. |
| `DisallowedAssetError` | Asset not in allowedAssets | Add the asset to allowedAssets or remove the filter |
| `PaymentRejectedError` with policy reason | On-chain spending-limit policy blocked the payment | Check the policy window — you may have hit the cap for this period |
| Up to 2x cap in short window | Window reset during payment burst | Expected behavior — see policies page for the full explanation |
| Session key signs but policy blocks | Token mismatch between policy scope and asset being paid | Use a token-scoped policy for the specific asset |

## Next steps

- [Pay for a resource](./pay-for-a-resource.md) — the full payment flow
- [Agent keys](../agent-tooling/agent-keys.md) — generate a scoped session key
- [Policies & provenance](../agent-tooling/policies.md) — deploy and manage spending-limit and
  verified-only policies
- [Sign and pay](./sign-and-pay.md) — what happens inside the payment loop
