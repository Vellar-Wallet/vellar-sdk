# Threat Model

> What Vellar is designed to prevent, what it is not designed to prevent, and the blast radius of each component if compromised.

By the end of this page you will understand the trust boundaries between the chain, the policy contracts, the facilitator and the client, what an attacker can do with each type of key, and exactly which parts of the system the pre-mainnet security review covered.

## Trust boundaries

Vellar is four components with different trust postures. The rule running through all of them: trust flows downward from the chain, never upward from a client claim.

| Component | Trusts | Does not trust |
| --- | --- | --- |
| Stellar consensus | Nothing. It is the root of trust | Any off-chain claim |
| Spending-limit policy | Only the chain | The facilitator, the agent, or the client |
| Vellar facilitator | The chain's simulation result | Buyer-supplied metadata, client-side budgets |
| vellar-sdk client | The facilitator's wire response | Anything it cannot verify on-chain |

The reason this ordering matters is that each layer can be compromised without the layer below it moving. A compromised client cannot make the facilitator settle something the chain refuses. A compromised facilitator cannot make the policy contract approve a payment over its cap, because the policy runs inside the wallet's `__check_auth` during authorization and Stellar consensus, not the facilitator, decides whether the transaction is valid.

## Blast radius by key type

Vellar wallets are Soroban smart contract accounts (`C` addresses), so "the key" is never one thing. Different keys carry different authority, and the blast radius differs accordingly.

| Key | If compromised | Cannot do |
| --- | --- | --- |
| Agent session key with a spending-limit policy | Spend up to the policy cap in the permitted token, until the key expires or is revoked | Exceed the on-chain budget, or take admin actions |
| Agent session key with a verified-only policy | Pay only contracts whose source is attested as verified | Pay an unattested contract |
| Agent session key with no policies | Full access for the granted token | Nothing is prevented. This is why scoped keys with policies exist |
| Sponsor secret key | Drain the sponsor XLM balance | Access buyer funds, forge settlements, or modify catalog entries |
| Channel account key | Submit one transaction from that account | Access buyer funds or the sponsor balance |

> ⚠️ **An unrestricted grant is deliberately not mintable through `wallet.agents`.** Each grant in `grants` is a `{ token, policies }` pair and must name at least one policy. The row above describes what an unrestricted key would mean, which is precisely why the API refuses to mint one.

Two properties bound the agent-key rows above. `expiresAt` accepts a `Date` or unix seconds, and an expired key stops signing with no revoke needed. `revoke` removes the key on-chain immediately once the transaction confirms. Both are chain-enforced, so neither depends on a compromised process cooperating.

> **Note:** The spending-limit policy validates the token and the amount and has no opinion on the recipient. A payment redirected to a different address within the cap satisfies the policy completely. This is documented in the security audit as V-1 and is an explicit design boundary, not a bug. See [Spending policies](./spending-policies.md).

## What the facilitator cannot do

The facilitator is the component most people assume is the weak point, because it is the hosted service in the middle. It is worth being precise about its actual authority.

It cannot:

- Forge a buyer's auth entry signature.
- Settle more than the buyer authorized. Under the exact scheme the auth entry fixes the amount, the asset and the recipient. Under the upto scheme it fixes a ceiling: `actual_amount` is set by the facilitator at settlement time and is not signed by the buyer at authorization time, so the bound the buyer signs is the maximum rather than the exact figure.
- Access buyer funds. On the fee-bump structure the `source_account` is the channel account and the `fee_account` is the sponsor. Older settlements from before the channel pool show the sponsor in both fields. On either path the buyer's address appears in neither. That is the non-custodial property.
- Override what the spending-limit policy enforces. The policy runs inside `__check_auth` on-chain.

What it can do, stated plainly: it can choose not to settle a valid payment. That is denial of service against the buyer. A `/settle` call can return `503 settlement_refused` with a reason, and the four spend-control refusal reasons are `rate_limited_payto`, `rate_limited_url`, `spend_ceiling` and `unbound_pool_exhausted`. Nothing in the design prevents a hostile or broken facilitator from refusing service, and nothing about running your own instance is optional if that matters to you.

The facilitator is open source at `github.com/Vellar-Wallet/vellar-facilitator`, so the mitigation for the denial-of-service case is running your own rather than trusting the hosted one.

## What the pre-mainnet review covers

The pre-mainnet security review covered:

- The facilitator service and its cryptographic validation.
- The settlement path and replay protection.
- The catalog ownership system, including the F11 finding and its fix.

The F11 work is worth describing because it demonstrates what the review actually tested. In a controlled A/B on 2026-08-08 UTC, four settlements were run, all `successful: true`. Pre-fix, the second settlement (`d56dc927a7c7c019197017b6a3dd92c198d9dce0d9d35749d8dbc896d0c4160d`, ledger 4040689) overwrote the catalog entry and inherited the legitimate seller's accumulated trust stats. Post-fix, the identical attack (`a909e4748c83f55972d6cee3286b8627c304b231037c7daae51d869bf17f1d38`, ledger 4040706) was refused by the trust-on-first-use binding and the catalog entry was unchanged.

Two honest qualifications on that result. "Blocked" means the catalog protected the seller, not that the payment failed: the attacker's payment still settled on-chain. And the control run matters, because without the pre-fix run showing the hijack working, "blocked" would be indistinguishable from a settlement that broke for unrelated reasons.

The pre-mainnet review does **not** cover:

- The spending-limit policy contract.
- The vellar-sdk client.
- The explorer indexer.

> ⚠️ **No external audit has been run on the policy contract.** A mainnet security audit of the spending-limit policy contract is one of the three mainnet gating items, alongside a persistent-disk deployment and a funded pubnet sponsor account. The facilitator review being complete does not carry over to the contract. See [Honesty](../reference/honesty.md).

## Prompt injection in the MCP payer

The MCP payer receives resource descriptions, service names, mime types and the resource body from whoever listed the resource. A malicious seller can put instructions in a description attempting to manipulate the agent into widening a spend limit or redirecting a payment. This is an untrusted input path by construction, not an edge case.

There are two defences.

**A nonce-bearing fence.** Untrusted text is wrapped in a fence whose terminator carries an 8-hex-character nonce drawn from a CSPRNG *after* the untrusted text is in hand, and never derived from it. A seller therefore cannot close the fence, because they cannot predict or compute the terminator. Any fence-shaped line inside the payload is replaced with a removal marker.

**Sanitisation.** C0 and C1 controls, DEL and the Unicode format class are stripped, which covers zero-width characters and the U+202A-202E and U+2066-2069 bidi overrides. Metadata is collapsed to a single line and clamped to 256 characters.

The same posture applies at catalog ingest, where `serviceName` must be printable ASCII of at most 64 characters (a non-ASCII name is silently dropped rather than transliterated), descriptions are clamped to 256 characters, and tags follow the same ASCII rule. Each field is sanitised individually before joining, so a newline smuggled into one value cannot forge an extra field.

> ⚠️ **A fenced block is a convention, not enforcement.** The nonce makes the boundary unforgeable and the sanitiser removes dangerous characters, but neither can compel a model to treat the enclosed text as data rather than instructions. That is a property of the model, not of this code. What actually bounds the damage is the spend limits and, above all, the chain-enforced budget. Treat the fence as defence in depth, never as the primary control.

## When it fails

| Threat | Defence | Limitation |
| --- | --- | --- |
| An agent overspends | The spending-limit policy validates the token and amount inside `__check_auth`, enforced by consensus | The window is fixed (tumbling), not sliding, so spending timed around a boundary can move up to 2x the cap in a short span |
| An agent pays the wrong recipient | The verified-only policy restricts recipients to contracts attested in the on-chain AttestationRegistry | The spending-limit policy has no opinion on the recipient (V-1). Verified means provenance, not audited or safe. Guarding the recipient is the application's responsibility |
| Catalog URL squatting | Trust-on-first-use binds a resource URL to the payTo of its first settled payment; a different payTo is refused from the catalog | The attacker's payment still settles on-chain. On the hosted instance the first-settler race reopens after each restart, because there is no persistent disk |
| Seller metadata injection | The nonce-bearing fence plus sanitisation in the MCP payer, and per-field ASCII sanitisation at catalog ingest | Neither can compel a model to treat fenced text as data. The real bound is the on-chain budget |
| A compromised agent key | Policies co-sign inside `__check_auth`; `expiresAt` stops the key signing with no revoke needed; `revoke` removes it on-chain once confirmed | A key granted with no policies has nothing preventing it, which is why an unrestricted grant is not mintable. Until expiry or revocation confirms, the cap is the bound, not zero |

## Next steps

- [Security](../security.md)
- [Honesty](../reference/honesty.md)
- [Spending policies](./spending-policies.md)
- [Agent keys](../agent-tooling/agent-keys.md)
