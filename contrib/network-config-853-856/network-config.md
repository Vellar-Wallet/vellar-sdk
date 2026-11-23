# NetworkConfig field history

Every field on `NetworkConfig` (`src/config.ts`), the version that added it,
and what a consumer who builds the object by hand has to do.

`usdcIssuer` and `usdcContractId` are the 0.6.2 breaking addition. Consumers
on the shipped `TESTNET` / `MAINNET` constants or `mainnetConfig()` already
have both. A custom object literal from before 0.6.2 should go through
`migrateNetworkConfig` (see the integration notes in this folder's README)
instead of looking the ids up by hand.

| Field | Added | Migration note |
| --- | --- | --- |
| `network` | 0.6.0 | `"testnet"` or `"mainnet"`. Required since the config object shipped. |
| `rpcUrl` | 0.6.0 | Testnet has the public SDF URL. Mainnet stays blank until you pass one to `mainnetConfig`. |
| `networkPassphrase` | 0.6.0 | Canonical passphrase for that network. Do not edit it without `nativeTokenContractId`. |
| `horizonUrl` | 0.6.0 | Public Horizon for that network. |
| `walletWasmHash` | 0.6.0 | Testnet hash ships with the SDK. Mainnet stays blank until you supply a verified hash. |
| `nativeTokenContractId` | 0.6.0 | Native XLM SAC id. It is derived from `networkPassphrase`. `assertNativeTokenMatchesPassphrase` checks the pair. |
| `usdcIssuer` | 0.6.2 | Circle's USDC issuer for that network. A wrong issuer silently accepts an impostor asset. Use `migrateNetworkConfig` for a pre-0.6.2 literal. |
| `usdcContractId` | 0.6.2 | USDC SAC id derived from `usdcIssuer` and the passphrase. A wrong contract id fails loudly via simulation (`UsdcSimulationError`), which is a different error from the RPC being unreachable (`UsdcNetworkError`). Use `migrateNetworkConfig` for a pre-0.6.2 literal. |

When `NetworkConfig` in `src/config.ts` gains a field, add a row to this table
in the same change. `check-network-config-fields.mjs` fails if a field in the
interface is missing from this page.

## Changelog note for 0.6.2

Add this to the 0.6.2 note in `CHANGELOG.md` (the contributor bot cannot edit
that file):

> Custom `NetworkConfig` literals that predate these fields should call
> `migrateNetworkConfig` (contrib/network-config-853-856, to be exported from
> `src/config.ts`). It copies `usdcIssuer` and `usdcContractId` from the
> shipped constants for `testnet` or `mainnet` and throws for any other
> network. Field-by-field history: this page.

## Interface comment

Add above `export interface NetworkConfig`:

> Field history, including the 0.6.2 `usdcIssuer` / `usdcContractId` addition:
> website/content/docs/reference/network-config.md
