# Pay for a Resource

> Pay an x402-protected HTTP endpoint from a Vellar smart account, with a
> mandatory spend cap and fee sponsorship so your account needs no XLM.

By the end of this page you will have paid a live x402 resource on
stellar:testnet using `wallet.x402.fetch()`, confirmed the on-chain settlement
hash, and understood why `maxAmount` is a guard and not the budget.

## Prerequisites

- `vellar-sdk` installed and a wallet created (see
  [Quickstart](../getting-started/quickstart.md))
- `x402` config passed to `createVellarWallet`
- A funded classic `G...` account for `simulationSourceAccount`, different from
  the paying account
- Testnet USDC in the paying smart account

> **Note:** The demo seller at `https://vellar-seller-demo.onrender.com/quote`
> charges 0.1 testnet USDC (Circle's official issuer
> `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) with sponsored
> fees. Use it to test without running your own seller.

## 1. Configure x402 on the wallet

```ts
import { createVellarWallet, createSessionKeySigner } from "vellar-sdk";

const vellar = createVellarWallet({
  network: "testnet",
  appName: "My Agent",
  kit,
  sac,
  backend,
  isValidAddress,
  x402: {
    // Agent flow: a scoped ed25519 session key signs headlessly (no passkey).
    signer: createSessionKeySigner({
      address: walletCAddress, // the smart account that pays
      secretKey: sessionKeySecret, // the session key attached to it
    }),
    simulationSourceAccount: aFundedGAccount,
    // Soroban RPC used for x402 simulation — required.
    rpcUrl: "https://soroban-testnet.stellar.org",
  },
});
```

`signer` decides who pays and how the auth entry is signed.
`simulationSourceAccount` is any funded classic account used only to simulate —
the facilitator rebuilds the transaction and pays the network fee. `rpcUrl` is
the Soroban RPC endpoint the SDK simulates against, and it is required.

> ⚠️ **simulationSourceAccount must be different from the payer.** If you
> simulate from the payer's own address, Soroban authorizes with source-account
> credentials instead of the wallet's auth entry, and the exact scheme rejects
> the payment with
> `invalid_exact_stellar_payload_unsupported_credential_type`. Use any funded
> `G...` account — it never signs and is never charged.

> ⚠️ **Use `createSessionKeySigner`, not `createPasskeyX402Signer`.** The passkey
> signer produces a correct signature shape but no deployed facilitator
> currently accepts human passkey-signed x402 payments. Build on the session-key
> path, which settles end to end against the hosted facilitator.

## 2. Get testnet USDC

Testnet USDC is freely obtainable with no faucet form: Friendbot an account,
then buy USDC on the testnet DEX with the Friendbot XLM.

```ts
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

const payer = Keypair.random();
await fetch(`https://friendbot.stellar.org?addr=${payer.publicKey()}`);

const account = await horizon.loadAccount(payer.publicKey());
const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.changeTrust({ asset: USDC }))
  .addOperation(
    Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax: "1000", // XLM you are willing to spend
      destination: payer.publicKey(),
      destAsset: USDC,
      destAmount: "0.5", // USDC you receive
    }),
  )
  .setTimeout(60)
  .build();
tx.sign(payer);
await horizon.submitTransaction(tx);
console.log("payer:", payer.publicKey(), "secret:", payer.secret());
```

## 3. Pay a resource

```ts
const { response, paid, settlement } = await vellar.x402.fetch(
  "https://api.example.com/paid",
  {
    maxAmount: 1_000_000n, // hard per-request ceiling, in the asset's base units
    // allowedAssets: [usdcSac], // optional — restrict which asset(s) you'll pay in
  },
);

if (paid && settlement) {
  console.log("settled on-chain:", settlement.transaction);
}
const data = await response.json(); // the unlocked resource
```

`fetch` returns three things: `response` is the unlocked HTTP `Response`, `paid`
says whether a payment was actually made, and `settlement` — present only when
`paid` — carries the on-chain record `{ transaction, payer, asset, amount,
network }`. If the resource needs no payment, it passes through untouched with
`paid: false`.

> ⚠️ **`maxAmount` is a guard, not the budget.** It refuses to *sign* a payment
> above the ceiling, but it is only as trustworthy as the client process. The
> real enforced budget is the spending-limit policy attached to the session key
> on-chain, which the chain enforces even if client code is bypassed. See
> [Spend controls](./spend-controls.md).

## 4. Verify the settlement

```ts
// The settlement object carries
// everything you need to verify
console.log("tx hash:", settlement.transaction);
console.log("amount paid:", settlement.amount);
console.log("asset:", settlement.asset);
console.log("network:", settlement.network);
```

View the transaction on the explorer: [explorer.vellar.xyz](https://explorer.vellar.xyz)

## 5. Pay the demo seller

Pay the deployed demo seller with the classic keypair from step 2 (from
`examples/` in the facilitator repo):

```sh
RESOURCE_URL="https://vellar-seller-demo.onrender.com/quote?topic=perseverance" \
PAYER_SECRET=S...   # the secret the script printed
node buyer-classic.mjs
```

> **Note:** The demo seller is a free Render instance — from deep sleep the
> first request can take a minute or more to answer.

## When it fails

| Error | Cause | Fix |
|---|---|---|
| `X402NotConfiguredError` at construction | `rpcUrl` missing or invalid URL | Pass `x402.rpcUrl` in createVellarWallet config |
| `X402NotConfiguredError` at fetch | x402 block missing from config entirely | Add the x402 field to createVellarWallet |
| `MaxAmountExceededError` | Server asked for more than your maxAmount | Raise maxAmount or choose a cheaper resource |
| `NoUsablePaymentOptionError` | Facilitator does not advertise areFeesSponsored: true | Use the Vellar facilitator URL which sponsors fees |
| `DisallowedAssetError` | Asset not in your allowedAssets list | Remove the allowedAssets filter or add the asset |
| `PaymentRejectedError` | On-chain policy blocked the payment (over budget, wrong token) | Check your spending-limit policy window and token scope |
| `invalid_exact_stellar_payload_unsupported_credential_type` | simulationSourceAccount is the payer | Use a different funded G account |
| Empty transaction field on settle | Soroban RPC transient TRY_AGAIN_LATER | Sign a fresh payload and retry once — nothing was spent |

## Next steps

- [Sign and pay](./sign-and-pay.md) — what happens between `fetch()` and the
  settlement hash
- [Spend controls](./spend-controls.md) — maxAmount vs the on-chain budget
- [Discover services](./discover-services.md) — find what to pay for without a
  hardcoded URL
- [Agent keys](../agent-tooling/agent-keys.md) — give an agent a scoped session key
