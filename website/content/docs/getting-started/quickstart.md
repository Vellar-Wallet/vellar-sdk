# Quickstart

> Go from zero to a working passkey wallet with a settled x402 payment in five
> minutes, using the hosted testnet backend.

By the end of this page you will have created a passkey wallet, reconnected to
it, sent a payment, and paid for an x402 resource — all against stellar:testnet
with no backend setup.

## Prerequisites

- Node.js 18 or later
- A modern browser with passkey support (Chrome, Safari, Firefox, Edge)
- npm or pnpm

> **Note:** Everything here runs on stellar:testnet. No real money, no mainnet.
> The hosted backend at `https://vellar-backend.onrender.com` handles fee
> sponsorship so your wallet needs no XLM.

## 1. Install

All three packages — the SDK, its Stellar peer, and the passkey engine you pass
in as `kit`:

```sh
npm install vellar-sdk @stellar/stellar-sdk passkey-kit
```

## 2. Create the client

```ts
import { PasskeyKit, SACClient } from "passkey-kit";
import {
  createVellarWallet,
  createHttpWalletBackend,
  TESTNET,
} from "vellar-sdk";
import { StrKey } from "@stellar/stellar-sdk";

const vellar = createVellarWallet({
  network: "testnet",
  appName: "My App",
  kit: new PasskeyKit({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
    walletWasmHash: TESTNET.walletWasmHash,
  }),
  sac: new SACClient({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
  }),
  // The hosted testnet backend — it holds the relayer/sponsor secrets.
  backend: createHttpWalletBackend("https://vellar-backend.onrender.com"),
  isValidAddress: (a) =>
    StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
});
```

`TESTNET` is shipped by the SDK and provides the RPC URL, network passphrase,
wallet wasm hash, and native-token contract id, so there are no magic values to
look up. `createHttpWalletBackend` is the ready-made client for the hosted
gateway.

> ⚠️ **Cold start warning.** The hosted backend sleeps after 15 minutes idle.
> The first request takes roughly 45 seconds (measured). This is a free-tier characteristic,
> not a bug. For production, run your own backend.

## 3. Create a wallet

Prompts the passkey once, registers the credential, and deploys the smart
account.

```ts
const session = await vellar.create({ username: "alice" });
console.log(session.accountId); // "C..." — the smart-account address
```

The `C...` address is a Soroban smart-contract account — not a classic keypair
account — which is what lets it carry on-chain policies.

## 4. Reconnect a returning user

```ts
const session = await vellar.connect();
```

If you persisted the session's `keyId` from a previous create or connect,
reconnect can resume without the WebAuthn discovery prompt.

## 5. Send a payment

Builds and **simulates** first, so errors such as insufficient balance surface
*before* the passkey prompt. Then the passkey signs and the transaction is
submitted, fee-sponsored.

```ts
const { hash } = await vellar.pay({
  to: "CDEST...",
  amount: 5_0000000n, // 5 XLM, in stroops (bigint)
  token: {
    contractId: TESTNET.nativeTokenContractId, // XLM's Stellar Asset Contract — shipped by TESTNET
    symbol: "XLM",
    decimals: 7,
  },
});

console.log("submitted:", hash);
```

Amounts are in the token's base units as a `bigint` — for XLM that means
stroops, where 1 XLM is 10,000,000 stroops (7 decimals).

## 6. Pay for an x402 resource

The same wallet can pay for HTTP-402 protected APIs. This is the agent payment
flow.

```ts
const { response, paid, settlement } = await vellar.x402.fetch(
  "https://api.example.com/paid",
  {
    maxAmount: 1_000_000n, // hard per-request ceiling, in the asset's base units
  },
);

if (paid) {
  console.log("settled on-chain:", settlement.transaction);
}
const data = await response.json(); // the unlocked resource
```

This requires an `x402` block on `createVellarWallet` — a signer, a
`simulationSourceAccount`, and an `rpcUrl`. Without it, calls on `wallet.x402`
throw `X402NotConfiguredError`.

> ⚠️ **Use the session-key signer, not the passkey signer.** The passkey signer
> produces a valid signature but no deployed facilitator currently accepts it.
> Build on createSessionKeySigner for x402 payments.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| Wallet creation hangs for roughly 45 seconds, up to 2 minutes | Backend cold start | Wait — it will respond. Allow up to 120 seconds in your timeout before retrying. |
| Passkey prompt never appears | Not in a secure context | Serve over HTTPS or localhost |
| `X402NotConfiguredError` | x402 config missing from createVellarWallet | Add the x402 block — see x402 payments page |
| `NoUsablePaymentOptionError` | Facilitator does not advertise areFeesSponsored | Use the Vellar facilitator URL, which sponsors fees |
| Settlement fails with empty transaction | Soroban RPC transient error | Sign a fresh payload and retry once |

## Next steps

- [Pay for a resource](../buyers/pay-for-a-resource.md) — the full x402 buyer
  flow with spend controls
- [Agent keys](../agent-tooling/agent-keys.md) — give an agent a scoped session
  key with an on-chain budget
- [Charge for an endpoint](../facilitator.md) — add a payment
  gate to your API
- [How it works](./how-it-works.md) — what happened under the hood
