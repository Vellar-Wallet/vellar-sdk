# Vellar Policies vs Stellar Multisig

> When to use a Vellar programmable policy and when to use native Stellar account multisig thresholds and signer weights, compared on threshold semantics, revocation speed and agent-key composability.

By the end of this page you will be able to state what each mechanism actually enforces, pick the right one (or the right combination) for a stated use case, and avoid the common mistake of expecting one to do the other's job.

## Two different questions

Native Stellar multisig answers **"who must sign?"** A classic (`G`) account carries a set of signers, each with a weight, and three thresholds (low, medium, high) that the summed weight of the signatures must reach for an operation of that category.

A Vellar policy answers **"what may be signed?"** A policy is a contract that co-signs inside the smart wallet's `__check_auth` (see [Spending Policies](./spending-policies.md)). It inspects the call itself (the token, the amount, the target contract) and refuses it if it is outside the rule, no matter who signed.

The two are not substitutes. Multisig cannot cap an amount, and a policy cannot make two humans agree.

## Side by side

| | Native Stellar multisig | Vellar programmable policy |
| --- | --- | --- |
| Account type | Classic `G...` account | Soroban smart wallet (`C...`) |
| Question answered | Who must sign | What may be signed |
| Threshold semantics | Sum of signer **weights** (0-255) must reach the low, medium or high threshold for the operation category | Every policy attached to the signer must co-sign; there is no summed weight. Any one policy refusing blocks the call |
| Inspects amounts and targets | No. Thresholds see only the operation category | Yes: token, amount per window, verified-only contract source |
| Revocation | A signer's weight is set to 0 with a `setOptions` transaction that itself needs signatures meeting the threshold for that operation | `wallet.agents.revoke` removes the signer in one passkey-signed transaction; the key stops signing when it confirms |
| Automatic expiry | None. A signer stays until someone removes it | Optional `expiresAt` on an agent key; an expired key stops signing without a revoke |
| Compromised signer blast radius | Whatever the signer's weight allows, up to full control if weight meets the high threshold | At most the remaining budget through policy-permitted contracts |
| Composes with agent keys | Not applicable to `wallet.agents` | Native: `grants` list the policies that must co-sign each token |

## Threshold semantics

**Multisig** adds weights. With a medium threshold of 2 and three signers of weight 1, any two signatures authorize a payment. Weights let one signer count for more than another, and three separate thresholds let routine operations need less than account changes. Nothing about the amount or destination changes the requirement.

**Policies** do not add anything up. Every policy named in a grant must succeed, so attaching a spending limit and a verified-only policy means both must pass. Stacking policies makes the signer *more* restricted, never less.

`PolicyDefinition` in the policy builder carries `owners` and an optional `threshold` that resemble multisig. Treat them as part of the definition you hand to a policy contract, not as a second multisig layer the SDK enforces for you: the SDK validates the shape (including duplicate owners), and the deployed contract decides what the threshold means.

> **Note:** A spending-limit policy checks the token and the amount, not the recipient. Neither mechanism by itself stops a payment redirected to a different address within the cap. See [Spending Policies](./spending-policies.md).

## Revocation speed

Both are on-chain, so both take effect when the transaction confirms. The difference is what it takes to get there.

- **Multisig:** removing a signer is an account change, so it must be signed by enough weight to meet the threshold for that operation. If the compromised signer holds a large share of the weight, revoking it may need the other signers to coordinate.
- **Agent key:** `wallet.agents.revoke(publicKey)` needs only the owner's passkey (one prompt). The agent holds no admin authority, so it cannot block its own removal. Expiry covers the case where nobody remembers to revoke.

## Composability with agent keys

`wallet.agents.mint` (see [Agent Keys](../agent-tooling/agent-keys.md)) adds an ed25519 signer whose limits name policy contracts per token. That is a policy feature: the agent key is a restricted signer inside a smart wallet, and the grant shape is `{ token, policies }`.

Native multisig weights have no equivalent in that call. A classic account cannot attach a spending-limit contract to a signer, so an agent you want to bound by amount belongs on a smart wallet. You can still pair them at the edges: a treasury held in a multisig `G...` account can fund the smart wallet the agent spends from, so the large balance sits behind human co-signing and the agent's budget sits behind policies.

## Decision guide

| Use case | Pick | Why |
| --- | --- | --- |
| An autonomous agent pays for APIs with a daily cap | Vellar policy via an agent key | The chain enforces the cap even if the agent is compromised |
| Two or three founders must all approve moving treasury funds | Native multisig | The requirement is human agreement, not an amount rule |
| A shared treasury where routine payouts need one signer but changing signers needs more | Native multisig with low/medium/high thresholds | Per-category thresholds express exactly this |
| A temporary contractor or agent key that should lapse on its own | Vellar policy with `expiresAt` | Multisig signers do not expire |
| Restrict spending to verified contract source | Vellar verified-only policy | Multisig cannot inspect call targets |
| Large reserves plus a small operating budget for an agent | Both | Multisig for the reserve, a smart wallet with agent keys for the budget |

If the question is "who", start with multisig. If the question is "how much, through what, for how long", use a policy. If you need both, keep them on separate accounts so each stays easy to reason about.

## Honesty

- A policy is only as strong as its configuration. A grant with no policy is not mintable through `wallet.agents` precisely because it would be unrestricted.
- Multisig protects against a single compromised key only when no one signer's weight meets the threshold alone. Check the weights, not just the signer count.
- Verified is not safe: see [Policies](../agent-tooling/policies.md).

## Next steps

- [Spending Policies](./spending-policies.md)
- [Agent Keys](../agent-tooling/agent-keys.md)
- [Threat model](./threat-model.md)
