# Quickstart

> Go from zero to a settled x402 payment in under two minutes, from a
> terminal, with no wallet setup and no browser.

By the end of this page you will have searched the Bazaar, paid for a
resource from the command line, and know where to go next to list your own
endpoint or build a passkey wallet.

## Prerequisites

- Node.js 18 or later
- A funded Stellar testnet secret key (`S...`) — see
  [Sign and Pay](../buyers/sign-and-pay.md) if you need one

> **Note:** Everything here runs on stellar:testnet. No real money, no mainnet.

## 1. Install

```sh
npm install -g vellar-cli
```

## 2. Search the Bazaar

```sh
vellar search "quote generation"
```

Each result is a real payable resource — its `payTo`, its price, and how many
agents have already paid it — with no hardcoded URL required.

## 3. Pay for a resource

```sh
vellar pay <url> \
  --secret-file ./key.txt \
  --network testnet \
  --max 1000000
```

`--max` is a hard ceiling in the asset's base units: the payment is refused,
unsigned, if the price exceeds it. On success you get the unlocked content and
a settlement transaction hash you can verify on Horizon. See the
[CLI guide](../agent-tooling/cli.md) for `quote` (check price without paying)
and `inspect` (look up a settlement afterwards).

## 4. List your own endpoint

The same facilitator that just verified and settled your payment can do the
same for an API you run. Once your endpoint declares the Bazaar discovery
extension, the first settled payment against it catalogs it automatically —
no registration step. See
[Charge for an endpoint](../sellers/charge-for-an-endpoint.md) to add a
payment gate to a route you already have.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| `Refused: price N exceeds --max M` | The ceiling is checked before signing | Raise `--max`, or pick a cheaper resource |
| `Error: provide --secret-file ...` | No secret was supplied by flag, file, or `VELLAR_SECRET` | Supply one — see [Sign and Pay](../buyers/sign-and-pay.md) |
| `Could not build the payment` | Usually no trustline to the asset, or an empty balance | Add the trustline and fund the account |

See the [CLI guide](../agent-tooling/cli.md#when-it-fails) for the full list.

## Next steps

- [Discover services](../buyers/discover-services.md) — more on searching and
  filtering the Bazaar
- [Policies](../agent-tooling/policies.md) — cap what an agent can spend,
  enforced on-chain
- [Charge for an endpoint](../sellers/charge-for-an-endpoint.md) — get your
  own API discovered and paid
- [Vellar CLI](../agent-tooling/cli.md) — the full command reference

## Building a passkey wallet

Everything above pays from a plain funded keypair. If you're building a
consumer-facing app and want passkey-based smart accounts instead — no seed
phrase, fee-sponsored submission — this section walks through creating one and
sending a payment from code, using the hosted testnet backend.

### 1. Install

Install [`vellar-sdk`](https://www.npmjs.com/package/vellar-sdk) with its
Stellar peer and the passkey engine you pass in as `kit`:

```sh
npm install vellar-sdk @stellar/stellar-sdk passkey-kit
```

### 2. Create the client

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
  backend: createHttpWalletBackend("https://vellar-backend-production.up.railway.app"),
  isValidAddress: (a) =>
    StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
});
```

`TESTNET` is shipped by the SDK and provides the RPC URL, network passphrase,
wallet wasm hash, and native-token contract id, so there are no magic values to
look up. `createHttpWalletBackend` is the ready-made client for the hosted
gateway.

### 3. Create a wallet

Prompts the passkey once, registers the credential, and deploys the smart
account.

```ts
const session = await vellar.create({ username: "alice" });
console.log(session.accountId); // "C..." — the smart-account address
```

The `C...` address is a Soroban smart-contract account — not a classic keypair
account — which is what lets it carry on-chain policies.

### 4. Reconnect a returning user

```ts
const session = await vellar.connect();
```

If you persisted the session's `keyId` from a previous create or connect,
reconnect can resume without the WebAuthn discovery prompt.

### 5. Send a payment

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

### 6. Pay for an x402 resource from the wallet

The same wallet can pay for HTTP-402 protected APIs directly from code.

```ts
const { response, paid, settlement } = await vellar.x402.fetch(
  "https://api.example.com/paid",
  {
    maxAmount: 1_000_000n, // hard per-request ceiling, in the asset's base units
  },
);

if (paid && settlement) {
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

### When the wallet quickstart fails

| Symptom | Cause | Fix |
|---|---|---|
| Passkey prompt never appears | Not in a secure context | Serve over HTTPS or localhost |
| `X402NotConfiguredError` | x402 config missing from createVellarWallet | Add the x402 block — see x402 payments page |
| `NoUsablePaymentOptionError` | Facilitator does not advertise areFeesSponsored | Use the Vellar facilitator URL, which sponsors fees |
| Settlement fails with empty transaction | Soroban RPC transient error | Sign a fresh payload and retry once |

See [Wallet API Reference](../api-reference.md) for the full config, and
[How it works](./how-it-works.md) for what happens under the hood.
