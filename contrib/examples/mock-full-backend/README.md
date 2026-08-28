# Mock end-to-end wallet backend

A fully in-memory `WalletBackend` — `submitWalletCreation`, `lookupContractId`,
and `submitTransaction` — backed by an append-only ledger of submitted
transactions queryable by hash. Wired into a real `createVellarWallet` handle
(with equally minimal mock `kit`/`sac`) to demonstrate a complete
create-then-pay sequence with no WebAuthn prompt, RPC call, or relayer.

## Usage

```ts
import { createMockVellarWallet } from "./mock-full-backend";

const { wallet, backend } = createMockVellarWallet("testnet");
const session = await wallet.create();
const { hash } = await wallet.pay({ to: "G...", amount: 100_0000000n, token });

backend.getTransaction(hash); // { hash, signedXdr, network, submittedAt }
backend.listTransactions();   // every submission so far, oldest first
```

`createMockWalletBackend()` on its own gives you just the backend, if you
want to wire it into your own kit/sac instead of the ones this example
provides.

## Run it

```sh
npx tsx mock-full-backend.ts
```

Expected output (hashes vary only in their counter suffix):

```
Step 1: create the wallet
  session.accountId = CMOCKSMARTACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Step 2: send a payment
  submitted, hash = mocktxhash100000
Step 3: send a second payment
  submitted, hash = mocktxhash200000
Step 4: query the ledger by hash
  getTransaction(first.hash) -> {"hash":"mocktxhash100000","signedXdr":"signed:unsigned-transfer-tx:CUSDCMOCK","network":"testnet","submittedAt":"..."}
Step 5: list every submitted transaction
  listTransactions() has 2 entries
```

## Tests

```sh
npx vitest run contrib/examples/mock-full-backend
```
