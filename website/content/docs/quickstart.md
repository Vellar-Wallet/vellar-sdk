# Quickstart

Get a working passkey wallet — create, reconnect, and send a payment — in a few
minutes.

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
  // Point at YOUR backend — it holds the relayer/sponsor secrets.
  backend: createHttpWalletBackend("https://api.myapp.com"),
  isValidAddress: (a) =>
    StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
});
```

`TESTNET` (shipped by the SDK) provides the RPC URL, passphrase, wallet wasm
hash, and native-token id — no more digging for magic values. And
`createHttpWalletBackend` is the ready-made client for your gateway.

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
    contractId: nativeTokenId,
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
