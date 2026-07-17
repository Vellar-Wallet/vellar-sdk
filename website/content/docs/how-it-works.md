# How It Works

Vellar SDK composes several ecosystem primitives behind one clean interface.
Here's what's happening underneath.

## Passkeys → smart accounts

When a user creates a wallet:

1. The SDK asks the `PasskeyKit` engine to **register a passkey** (WebAuthn). The
   private key is generated and stored in the device's secure enclave — it never
   leaves the device, and there is no seed phrase.
2. The passkey's public key becomes a **signer on a Soroban smart-wallet
   contract**. Each wallet is a smart contract account (a `C...` address), not a
   classic keypair account.
3. The deployment transaction is submitted through your backend.

Because the account is a smart contract, it can enforce **programmable
policies** — spending limits, multisig, allowlists — on-chain.

## Signing

To sign, the SDK builds a transaction, has the passkey authorize the wallet's
auth entries via WebAuthn, and hands the signed result to your backend for
submission. The signature happens on the user's device; nothing is signed
without an explicit passkey prompt.

## Why submission goes through your backend

Fees on Stellar are sponsored so the user's wallet needs no XLM. Sponsorship
requires an OpenZeppelin Relayer API key (and, for certain address-bound
credentials, a funded sponsor account). **These are secrets.** They must live on
your server, never in the browser.

So the SDK never submits directly — it hands the signed transaction to your
`backend.submitTransaction`, and your server does the fee-sponsored submit. The
SDK holds no secrets at any point.

```
 user device                    your server                 Stellar
 ┌──────────┐                   ┌──────────┐               ┌────────┐
 │ passkey  │  signed XDR  ───► │ relayer/ │  ──────────►  │  RPC   │
 │ (SDK)    │                   │ sponsor  │               │        │
 └──────────┘  ◄── tx hash ──── └──────────┘  ◄─────────── └────────┘
```

## Sessions & reconnect

A session carries the smart-account address, the network, and (optionally) the
passkey's credential id (`keyId`). Persisting the `keyId` lets a returning user
reconnect without the WebAuthn discovery ceremony — the passkey prompt then only
appears at signing time.

## Programmable policies (roadmap)

Because accounts are smart contracts, Vellar wallets can carry on-chain policies
— e.g. a **cumulative rolling-window spending limit** that bounds how much can
move per period, enforced by the network rather than by client-side checks. A
dedicated policy SDK for authoring and deploying these is on the roadmap; the
underlying contract already exists.
