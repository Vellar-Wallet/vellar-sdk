# NetworkConfig migration, history, and consistency (#853 #854 #855 #856)

Contributor pull requests on this repo may only change `contrib/`. A bot
closes anything else, including edits to `src/config.ts`, `CHANGELOG.md`,
and `website/`. This folder is the implementation, tested against the real
`TESTNET`, `MAINNET`, and `mainnetConfig()` exports. A maintainer copies it
into core using the steps below.

## What is here

| File | Issue |
| --- | --- |
| `network-config.ts` `migrateNetworkConfig` | #856 fills `usdcIssuer` and `usdcContractId` from the shipped constants. Throws if `network` is not testnet or mainnet. |
| `network-config.md` | #855 field history. `usdcIssuer` and `usdcContractId` are the 0.6.2 rows. The changelog paragraph and the interface comment to paste are in that file. |
| `check-network-config-fields.mjs` | #855 fails when `src/config.ts` grows a `NetworkConfig` field the doc page does not name. |
| `assertNativeTokenMatchesPassphrase` | #854 re-derives the native SAC id from `networkPassphrase` and compares it to `nativeTokenContractId`. Covered for `TESTNET`, `MAINNET`, and `mainnetConfig()`. |
| `usdc-simulation.ts` | #853. A wrong contract id becomes `UsdcSimulationError`. A refused connection becomes `UsdcNetworkError`. A missing result is not reported as a zero balance. |

`src/config.ts` already notes that a wrong `usdcContractId` fails loudly in
simulation and a wrong issuer does not. `readUsdcBalanceViaSimulation` is the
tested form of the contract-id half of that sentence.

## Verify

```sh
node contrib/network-config-853-856/check-network-config-fields.mjs
npx vitest run contrib/network-config-853-856/network-config.test.ts
```

The default `npm test` already picks up the vitest file.

## Integration into core

1. Move `migrateNetworkConfig`, `deriveNativeSacContractId`,
   `assertNativeTokenMatchesPassphrase`, and the two error classes into
   `src/config.ts`. Export them from the package (the file is already
   re-exported by `src/index.ts`).
2. Move `readUsdcBalanceViaSimulation` and `UsdcSimulationError` /
   `UsdcNetworkError` next to `src/balances-rpc.ts`.
3. Copy `network-config.md` to
   `website/content/docs/reference/network-config.md` and add a `DOC_PAGES`
   entry in `website/lib/docs-registry.ts` with slug
   `reference/network-config`.
4. Paste the changelog paragraph from `network-config.md` into the 0.6.2
   note in `CHANGELOG.md`, and paste the interface comment onto
   `NetworkConfig`.
5. Add `node contrib/network-config-853-856/check-network-config-fields.mjs`
   to `.github/workflows/ci.yml` (or move the script to `scripts/` at the
   same time). Point the script at the website copy of the doc once that
   file exists.
6. Add a contributor checklist line: a new `NetworkConfig` field needs a row
   on the history page.

## Maintainer review

#853, #854, #855, and #856 each ask for maintainer review before merge.
This PR is the review package. It does not edit `src/` because that PR
would be closed on open.
