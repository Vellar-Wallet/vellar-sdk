# Verify the mainnet wallet WASM hash

> `MAINNET.walletWasmHash` is blank on purpose. This page shows exactly how to
> obtain the hash for **your installed passkey-kit version** from the official
> deployment manifest, and how to confirm you read the right row.

By the end of this page you will be able to name the passkey-kit release tag,
the manifest file it points to, and the mainnet `smart-wallet` row that your
`walletWasmHash` came from.

> **Mainnet is pending a security review.** Completing these steps prepares a
> correct config; it does not make mainnet production-ready.

## Prerequisites

- An exact installed passkey-kit version (not a semver range)
- A mainnet Soroban RPC provider URL (SDF does not run a free public mainnet RPC)
- A clear understanding that a wrong-but-valid hash fails **silently**: the
  wallet is created against a different contract and does not report the mistake

## 1. Find the exact installed passkey-kit version

```bash
npm list passkey-kit
```

Use the resolved version from the output (for example `passkey-kit@0.16.5`),
not the range in `package.json`. Every subsequent URL must use that exact
version as a tag: `v<installed-version>`.

## 2. Find the manifest named by that version's README

Open the README at the **matching release tag**:

```text
https://github.com/stellar/passkey-kit/blob/v<installed-version>/README.md
```

Look for the sentence that names the **canonical WASM hash** manifest. The
manifest path changes when passkey-kit repins its contracts, so the pointer in
your installed version's tag is the only reliable one. The raw equivalent can
be checked from a terminal:

```bash
curl -fsSL "https://raw.githubusercontent.com/stellar/passkey-kit/v<installed-version>/README.md" \
  | rg -i 'canonical WASM hash'
```

### Worked example

For `passkey-kit@0.16.5`, the tagged README points at
`docs/deployments-2026-08-19.md`, so the manifest to open is:

```text
https://github.com/stellar/passkey-kit/blob/v0.16.5/docs/deployments-2026-08-19.md
```

Earlier tags may point at an older file (for example
`docs/deployments-testnet-2026-07-11.md`). That difference matters: the newer
manifest can publish a different, fixed contract hash. Always follow the
pointer in the tag you actually installed.

## 3. Read the mainnet `Smart wallet` row

The manifest publishes hashes in a table. Find the row whose network is
**Mainnet** and whose contract is `smart-wallet`; the hash is the 64-character
hex value in that row:

```md
| Network | Contract        | binver | Smart wallet hash                          |
| --- | --------------- | ------ | ------------------------------------------ |
| Testnet | `smart-wallet` | 1.0.1  | `<testnet hash — do not use on mainnet>`   |
| Mainnet | `smart-wallet` | 1.0.1  | `<64-hex-char mainnet hash from this row>` |
```

That final placeholder is where a real manifest prints the hash you copy.
Before copying it, confirm all three things:

1. The URL contains `v<installed-version>` — not the repository's default
   branch and not a different release tag.
2. The URL's manifest path is the one named by that tag's README.
3. The row is `Network: Mainnet`, `Contract: smart-wallet` — not the testnet
   row, and not another contract such as the SAC.

The hash must be exactly 64 hexadecimal characters. If it is not, you copied
the wrong column. If it equals `TESTNET.walletWasmHash`, you copied the wrong
network row — `mainnetConfig()` validates the shape of the hash, but it cannot
know whether you picked the right network.

## 4. Pass the verified hash through `mainnetConfig()`

```ts
import { mainnetConfig } from "vellar-sdk";

const network = mainnetConfig({
  rpcUrl: process.env.MAINNET_RPC_URL!,
  walletWasmHash: process.env.MAINNET_WALLET_WASM_HASH!, // copied from step 3
});
```

Never spread the bare `MAINNET` constant and leave its blank fields in place.
`mainnetConfig()` fills the verified fields and throws when either required
value is missing or malformed, with a typed `error.code` you can branch on.

## When verification fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tagged README has no "canonical WASM hash" pointer | Wrong tag, or the README format changed | Re-check `npm list passkey-kit`; stop rather than guess a manifest path |
| Manifest has no `Mainnet` / `smart-wallet` row | Wrong manifest for that version, or no mainnet deployment exists for it | Stop; do not substitute the testnet row |
| Hash is not 64 hex characters | Wrong table column or a transcription error | Re-copy the value from the `smart-wallet` row |
| Hash matches `TESTNET.walletWasmHash` | Testnet row copied into a mainnet config | Re-open the manifest and copy the `Mainnet` row |
| `missing-rpcUrl` / `malformed-rpcUrl` / `missing-walletWasmHash` / `malformed-walletWasmHash` | `mainnetConfig()` rejected the supplied values | See [Error Codes](../reference/error-codes.md) for one action per code |

## Next steps

- [Error Codes](../reference/error-codes.md) — the stable `MainnetConfigError`
  codes and what each one means
- [Quickstart](./quickstart.md) — the wallet/payment flow, shown on testnet
