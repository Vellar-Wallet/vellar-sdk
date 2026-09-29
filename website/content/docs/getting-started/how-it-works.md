# How It Works

> Vellar runs a hosted x402 payment facilitator with Bazaar discovery on
> Stellar. This page explains the payment loop step by step, how agent
> spending controls fit in, and — for apps that want one — how the optional
> passkey smart wallet works.

By the end of this page you will understand how the payment loop works from a
402 challenge to an on-chain settlement and an auto-cataloged listing, and how
on-chain spending controls bound what an agent can do.

## The four participants

Every Vellar payment involves four parties. Keep these straight — confusion
here causes most auth entry mistakes.

| Participant | What they are | What they hold |
|---|---|---|
| Buyer | The account that pays | The payment asset (e.g. USDC). Needs no XLM. |
| Seller (payTo) | The account that receives payment | Needs a trustline to the asset |
| Facilitator | Vellar's hosted service | XLM for fees. Never holds buyer funds. |
| Token contract | The SEP-41 asset's Stellar Asset Contract | The on-chain asset |

## The payment loop

When a buyer pays an x402 resource, this is what happens step by step:

1. **Request the resource.** The client makes an ordinary HTTP request to a
   paid endpoint.
2. **Receive the 402 challenge.** The resource server answers with `402 Payment
   Required` plus payment requirements — amount, asset, recipient, network.
3. **Build the transfer.** The client builds the SEP-41
   `transfer(from = payer, to = payTo, amount)`.
4. **Sign the auth entry.** The Soroban authorization entry is signed with the
   payer's key, producing V1 (`sorobanCredentialsAddress`) credentials in the
   format the exact scheme expects.
5. **Retry with the payment header.** The client repeats the request carrying
   the `PAYMENT-SIGNATURE` header.
6. **Verify and settle.** The facilitator verifies by re-simulation — which for
   a policy-governed smart account also runs `__check_auth`, and therefore the
   budget policy — then settles on-chain and sponsors the fee.
7. **Auto-catalog.** A settled payment whose resource declared the Bazaar
   discovery extension is cataloged automatically — no separate registration
   step. The next agent that searches finds it.

Because verification re-simulates, an over-budget or wrong-token payment is
rejected *before* it settles. The [CLI](../agent-tooling/cli.md) and the
[MCP payer](../agent-tooling/mcp-payer.md) both run this loop from a plain
funded keypair — no smart account or passkey required.

## Agent spending controls

An agent's spending can be bounded two ways, and they compose:

- **Process-level ceilings** — a per-call `max_amount` and a per-session budget
  enforced by the CLI or MCP payer itself, checked *before* anything is signed.
- **On-chain policies** — for a policy-governed smart account, a
  spending-limit policy caps *how much* can move per fixed window and a
  verified-only policy restricts payments to contracts whose source has been
  reproducibly verified — provenance, not an audit. Both are enforced by
  Stellar consensus rather than by your code, so they bind even a fully
  compromised agent that bypasses your application entirely.

See [Policies](../agent-tooling/policies.md) for the full authoring and deploy
flow.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| `X402NotConfiguredError` at construction | `rpcUrl` missing or invalid URL | Pass `x402.rpcUrl` in config |
| `invalid_exact_stellar_payload_unsupported_credential_type` | `simulationSourceAccount` is the same as the payer | Use a different funded G account for simulation |
| Payment settles but nothing is cataloged | `required.extensions` not echoed in payload | Echo extensions in your buyer — see Facilitator guide |

## Optional: passkey smart accounts

Everything above works from a plain funded keypair. If you're building a
consumer-facing app and want passkey-based smart accounts instead — no seed
phrase, fee-sponsored submission, on-chain policies attached per-wallet — this
section covers what happens under the hood.

### Passkeys to smart accounts

When a user creates a wallet:

1. **Register the passkey.** The SDK asks the `PasskeyKit` engine to register a
   WebAuthn credential; the private key is generated and stored in the device's
   secure enclave, so it never leaves the device and there is no seed phrase.
2. **The passkey becomes a signer.** Its public key is installed as a signer on
   a Soroban smart-wallet contract, so each wallet is a smart contract account
   (a `C...` address) rather than a classic keypair account.
3. **Deploy through your backend.** The deployment transaction is submitted via
   your backend, which holds the sponsorship credentials.

Because the account is a smart contract, it can enforce the same programmable
policies described above — spending limits, multisig, allowlists — attached
directly to the wallet's own `__check_auth`.

### Why submission goes through your backend

> ⚠️ **Never submit directly from the browser.** Fee sponsorship requires
> secrets (OpenZeppelin Relayer API key, funded sponsor account). These must
> live on your server. The SDK holds no secrets at any point.

Fees on Stellar are sponsored so the user's wallet needs no XLM, and sponsorship
requires an OpenZeppelin Relayer API key and, for certain address-bound
credentials, a funded sponsor account. The SDK therefore builds and signs the
transaction on the user's device — the passkey authorizes the wallet's auth
entries via WebAuthn — then hands the signed XDR to your `backend.submitTransaction`,
and your server performs the fee-sponsored submit and returns the hash.

```
 user device                    your server                 Stellar
 ┌──────────┐                   ┌──────────┐               ┌────────┐
 │ passkey  │  signed XDR  ───► │ relayer/ │  ──────────►  │  RPC   │
 │ (SDK)    │                   │ sponsor  │               │        │
 └──────────┘  ◄── tx hash ──── └──────────┘  ◄─────────── └────────┘
```

### Sessions and reconnect

A session carries the smart-account address, the network, and optionally the
passkey's credential id (`keyId`). Persisting the `keyId` lets a returning user
reconnect without the WebAuthn discovery ceremony — the passkey prompt then only
appears at signing time.

See [Wallet API Reference](../api-reference.md) for the full `createVellarWallet`
config.

## Next steps

- [Pay for a resource](../buyers/pay-for-a-resource.md) — the full x402 buyer
  flow with spend controls
- [Policies](../agent-tooling/policies.md) — cap what an agent can spend,
  enforced on-chain
- [Vellar CLI](../agent-tooling/cli.md) — discover, quote, and pay from a
  terminal, no wallet setup
- [Security](../security.md) — the guarantees the SDK enforces
