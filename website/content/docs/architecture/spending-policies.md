# Spending Policies

> How the spending-limit and verified-only policies are enforced inside `__check_auth`, why on-chain enforcement is structurally different from a software budget, and the recipient limitation the policy explicitly does not cover.

By the end of this page you will be able to trace the execution path from a payment through `__check_auth` to a policy decision, explain why a compromised agent process cannot exceed the on-chain budget, read an opaque policy refusal and tell it apart from a malformed signature map, and state precisely what the policy does not enforce.

## `__check_auth` is the enforcement point

Vellar wallets are Soroban smart contract accounts (`C` addresses). Every transfer out of one runs the wallet's `__check_auth`. Policies are co-signers registered inside `__check_auth`, so they are not consulted by the client, the SDK or the facilitator: they are consulted by the contract, during authorization, as part of the transaction itself.

That placement is what makes the guarantee structural rather than procedural.

When the facilitator re-simulates a payment at `/verify`, the simulation runs `__check_auth`. The policy therefore executes during simulation, and a payment that would exceed the cap is caught before settlement is attempted and before any funds move.

The chain enforces `__check_auth`, so the facilitator cannot approve a payment that `__check_auth` would reject. Nor can anything else. A compromised agent process, a buggy client, a modified SDK build or a hand-crafted envelope submitted directly to the network all meet the same contract, and the chain refuses the transaction regardless of what code submitted it.

A software budget is a check the spender performs on itself. A policy is a check the network performs on the spender. Those are different threat models: see [Threat model](./threat-model.md).

## The spending-limit policy execution path

1. A payment payload arrives at the facilitator's `POST /verify`.
2. The facilitator re-simulates the transaction rather than trusting the submitted claim.
3. Simulation invokes the wallet contract's `__check_auth` for the transfer.
4. `__check_auth` calls the policy's co-sign function, passing the transfer arguments.
5. The policy validates the token and checks the amount against cumulative spend in the current window.
6. If the payment is within the cap, the co-sign call succeeds, `__check_auth` returns, simulation succeeds, and `/verify` returns `isValid: true`.
7. If the payment is over the cap, the policy throws `Error(Contract, #1)`. `__check_auth` wraps it in `Error(Contract, #110)`, the simulation fails, and `/verify` returns `isValid: false`.

Nothing has been submitted at step 7, so nothing has been spent. The refusal costs a simulation, not a fee.

## Reading a policy refusal

The wallet wraps every auth failure in `Error(Contract, #110)`, so the top-level code says only "auth failed". The cause is nested one or two frames down, and the two common causes look identical at the top.

```text
# A policy refused the payment
Error(Contract, #110)
  [wallet] contract try_call failed: policy__(<transfer args>)
  [policy] VM call trapped with HostError: Error(Contract, #1)

# A malformed signature map: same top-level code, NO policy invocation
Error(Contract, #110)
  [wallet] ...
```

A failed `policy__` call is the signal that a policy refused. Its absence means the wallet never got as far as consulting a policy, which is a different problem with a different fix: the signature map itself was malformed.

> ⚠️ **A policy-governed key must carry its policies in the signature map.** The `SignerKey::Policy` entries go alongside the ed25519 one. Omit them and the wallet rejects the entry before consulting the policy, producing the same opaque `#110` with no `policy__` line. Reading only the top-level code will send you to tune a cap that was never reached.

## The fixed tumbling window

The spending-limit policy enforces a cumulative cap over a fixed (tumbling) window, not a sliding one. Spent resets to zero when the window elapses; it does not decay continuously.

> ⚠️ **Spending timed around a window boundary can move up to 2x the cap in a short span.** An agent can spend the full cap just before the reset and the full cap again just after. The limit is an on-chain guardrail, not a to-the-stroop hard cap. The contract itself recommends pairing it with a cryptographic co-signer for a hard guarantee.

Size the window for that worst case, and read it as "at most 2x the cap per window" rather than "at most the cap". This limitation is recorded in [Honesty](../reference/honesty.md) alongside everything else Vellar does not do today.

## What the policy enforces and does not

The spending-limit policy validates two things: the token and the amount. It has no opinion on the recipient.

> ⚠️ **"The agent cannot exceed its budget" is true; "the agent's funds are protected" is not.** A payment redirected to a different address, within the cap, satisfies the policy completely. The policy sees a permitted token and a permitted amount and co-signs. Guarding the recipient is the application's responsibility, not the chain's.

This is documented in the security audit as V-1, and it is an explicit design boundary rather than a bug. The policy's scope is amount and token. Recipient validation is an application-layer control, and an auditor should read the spending-limit policy as bounding loss magnitude, not loss direction.

The verified-only policy narrows the recipient set, but by code provenance rather than by address, so it is not a substitute for checking that a payment is going where your application intended.

## The verified-only policy

Instead of capping an amount, the verified-only policy reads an on-chain `AttestationRegistry` during `__check_auth` and rejects any payment whose recipient contract is not attested as verified. A payment to an unattested contract fails at authorization, before funds move.

The `AttestationRegistry` is a Soroban contract live on testnet, with ledger-based expiry so it fails closed: an attestation that is not renewed stops authorizing payments rather than lingering. The behaviour is directly testable. Attest a contract and payments to it settle; revoke the attestation and the identical payment is refused on-chain, with nothing changed but the registry entry.

Verified means provenance: reproducible source, an attributable origin, and deployed bytes matching a published wasm hash.

> ⚠️ **Verified does not mean audited, safe, or a wise payment.** Provenance says you can tell what code is running and who wrote it. It says nothing about whether that code is honest. A verified contract can still be hostile. See [Honesty](../reference/honesty.md).

## Stacking both policies

Neither policy is complete alone. Name both policy contracts in the same grant and both must co-sign every transfer of that token.

```ts
const { hash } = await wallet.agents.mint({
  publicKey: agentKey.publicKey(),
  grants: [
    {
      token: usdcSac,
      policies: [spendingLimitId, verifiedOnlyId],
    },
  ],
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
});
```

An agent key with both can spend up to the cap **and** only through contracts with verified source. A refusal from either one surfaces as the same `Error(Contract, #110)`, so read the nested `policy__` line to see which refused.

> **Note:** The cap is token-scoped. `grants` is a list of `{ token, policies }`, one entry per token, and a spending-limit policy bound to one token constrains that token only. A grant for a second token needs its own policies; each grant must name at least one, because an unrestricted grant is deliberately not mintable through `wallet.agents`.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/verify` returns `isValid: false` with a failed simulation | `__check_auth` rejected the payment during simulation, so nothing was submitted and nothing was spent | Read the nested cause: a `[wallet] contract try_call failed` line naming `policy__` means a policy refused; no `policy__` line means the signature map was malformed |
| Policy deployed, but the agent is not limited | The policy contract id is not in the agent key's grants, so it is never registered as a co-signer and never consulted | Mint the agent key with that policy contract id in the grant for the token |
| An agent spends past the budget you expected | The policy is scoped to a different token than the one being moved; the cap is token-scoped | Add a grant naming that token with its own policies, one grant per token |
| Up to 2x the cap moved in a short span | Expected: the window tumbles rather than slides, so the cap can be spent either side of a boundary | Size the window for that worst case, or pair the limit with a cryptographic co-signer for a hard guarantee |

## Next steps

- [Agent keys](../agent-tooling/agent-keys.md)
- [Policies](../agent-tooling/policies.md)
- [Honesty](../reference/honesty.md)
- [Threat model](./threat-model.md)
