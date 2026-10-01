# How It Works

> Vellar combines passkey-based smart accounts with a hosted x402 payment
> facilitator. This page explains what happens under the hood when a user
> creates a wallet and makes a payment.

By the end of this page you will understand the passkey-to-smart-account flow,
why submission goes through your backend, and how the payment loop works from a
signed auth entry to an on-chain settlement.

## The four participants

Every Vellar transaction involves four parties. Keep these straight — confusion
here causes most auth entry mistakes.

| Participant | What they are | What they hold |
|---|---|---|
| Buyer | The account that pays | The payment asset (e.g. USDC). Needs no XLM. |
| Seller (payTo) | The account that receives payment | Needs a trustline to the asset |
| Facilitator | Vellar's hosted service | XLM for fees. Never holds buyer funds. |
| Token contract | The SEP-41 asset's Stellar Asset Contract | The on-chain asset |

## Passkeys to smart accounts

When a user creates a wallet:

1. **Register the passkey.** The SDK asks the `PasskeyKit` engine to register a
   WebAuthn credential; the private key is generated and stored in the device's
   secure enclave, so it never leaves the device and there is no seed phrase.
2. **The passkey becomes a signer.** Its public key is installed as a signer on
   a Soroban smart-wallet contract, so each wallet is a smart contract account
   (a `C...` address) rather than a classic keypair account.
3. **Deploy through your backend.** The deployment transaction is submitted via
   your backend, which holds the sponsorship credentials.

Because the account is a smart contract, it can enforce programmable policies —
spending limits, multisig, allowlists — on-chain.

## Why submission goes through your backend

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

## The payment loop

When a buyer pays an x402 resource, this is what happens step by step:

1. **Request the resource.** The client makes an ordinary HTTP request to a
   paid endpoint.
2. **Receive the 402 challenge.** The resource server answers with `402 Payment
   Required` plus payment requirements — amount, asset, recipient, network.
3. **Build the transfer.** The client builds the SEP-41
   `transfer(from = smart account, to = payTo, amount)`.
4. **Sign the auth entry.** The wallet's Soroban authorization entry is signed
   with the session key, producing V1 (`sorobanCredentialsAddress`) credentials
   in the format the account's `__check_auth` expects.
5. **Retry with the payment header.** The client repeats the request carrying
   the `PAYMENT-SIGNATURE` header.
6. **Verify and settle.** The facilitator verifies by re-simulation — which runs
   the account's `__check_auth`, and therefore the budget policy — then settles
   on-chain and sponsors the fee.

Because verification re-simulates, an over-budget or wrong-token payment is
rejected *before* it settles.

## Sessions and reconnect

A session carries the smart-account address, the network, and optionally the
passkey's credential id (`keyId`). Persisting the `keyId` lets a returning user
reconnect without the WebAuthn discovery ceremony — the passkey prompt then only
appears at signing time.

## Programmable policies

Because accounts are smart contracts, Vellar wallets can carry on-chain policies
— for example a cumulative fixed-window spending limit that bounds how much can
move per window, enforced by the network rather than by client-side checks a
malicious frontend could skip. The SDK exposes the full authoring and deploy
flow as [`wallet.policies`](../agent-tooling/policies.md).

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| First request takes roughly 45 seconds | Render free tier cold start | Send a warming GET /health first |
| `X402NotConfiguredError` at construction | `rpcUrl` missing or invalid URL | Pass `x402.rpcUrl` in config |
| `invalid_exact_stellar_payload_unsupported_credential_type` | `simulationSourceAccount` is the same as the payer | Use a different funded G account for simulation |
| Payment settles but nothing is cataloged | `required.extensions` not echoed in payload | Echo extensions in your buyer — see Facilitator guide |

## Next steps

- [Quickstart](./quickstart.md) — create a wallet in five minutes
- [x402 payments](../buyers/pay-for-a-resource.md) — pay for a resource from code
- [Agent keys](../agent-tooling/agent-keys.md) — give an agent a scoped session key
- [Security](../security.md) — the guarantees the SDK enforces
