# Quickstart

Get a working passkey wallet — create, reconnect, and send a payment — in a few
minutes. Once you have a wallet, add [x402 payments](./x402.md) to pay for
HTTP-402 resources, and [agent keys](./agent-keys.md) to let an agent pay on its
own under on-chain limits.

## 0. Install

All three packages — the SDK, its Stellar peer, and the passkey engine you pass
in as `kit`:

```sh
npm install vellar-sdk @stellar/stellar-sdk passkey-kit
```

> **Need a funded testnet account?** Some flows (like
> [x402's](./x402.md) `simulationSourceAccount`) need a funded classic `G...`
> account. Friendbot funds any testnet account for free:
>
> ```sh
> curl "https://friendbot.stellar.org?addr=GYOUR_ACCOUNT_ID_HERE"
> ```
>
> Wallet creation and payments in THIS quickstart don't need one — deployment
> and fees are sponsored by the backend.

## 1. Create the client

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

`TESTNET` (shipped by the SDK) provides the RPC URL, passphrase, wallet wasm
hash, and native-token id — no more digging for magic values. And
`createHttpWalletBackend` is the ready-made client for the gateway.

> **About that backend URL.** `https://vellar-backend.onrender.com` is the
> hosted testnet gateway (the same one the [hackathon](./hackathon.md#getting-started)
> uses) — fine for the hackathon and prototyping. It runs on a free Render
> instance that sleeps when idle, so the **first request after a quiet spell can
> take 30–90 seconds — occasionally up to ~2 minutes** while it wakes; retry
> rather than assuming a bug.
> For production you run your own backend — it's three routes holding your
> relayer/sponsor secrets; see [Installation](./installation.md#what-you-supply)
> and [How It Works](./how-it-works.md).

## 2. Create a wallet

Prompts the passkey once, registers the credential, and deploys the smart
account.

```ts
const session = await vellar.create({ username: "alice" });
console.log(session.accountId); // "C..." — the smart-account address
```

## 3. Reconnect a returning user

```ts
const session = await vellar.connect();
```

If you persisted the session's `keyId`, reconnect can resume without a WebAuthn
prompt — see [Wallet Methods](./wallet-methods.md).

## 4. Send a payment

Builds and **simulates** first, so errors (e.g. insufficient balance) surface
_before_ the passkey prompt. Then the passkey signs and the transaction is
submitted (fee-sponsored).

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

That's the full loop: **create → reconnect → pay**, all passkey-signed and
non-custodial.

## Next steps

- [How It Works](./how-it-works.md) — passkeys, smart accounts, sponsorship
- [Security](./security.md) — the guarantees the SDK enforces
- [`createVellarWallet`](./api-reference.md) — the full config reference
- [Wallet Methods](./wallet-methods.md) — every method on the wallet handle
