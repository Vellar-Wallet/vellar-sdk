# CAIP-2 Network Identifiers Example (#111)

Lists the CAIP-2 (Chain Agnostic Improvement Proposal 2) network identifiers used throughout the Vellar SDK ecosystem. Purely a static constant lookup with zero network overhead.

## Supported Identifiers

| CAIP-2 Identifier | Network Name | Environment | Description |
| --- | --- | --- | --- |
| `stellar:pubnet` | Stellar Public Mainnet | Production | Live network for asset settlements & Soroban contracts |
| `stellar:testnet` | Stellar Testnet | Testnet | Public test environment for dApps & x402 payment flows |
| `stellar:futurenet` | Stellar Futurenet | Devnet | Developer network for previewing protocol features |

## SDK Usage Note

CAIP-2 identifiers are standardized `<namespace>:<reference>` strings used in the SDK for:
- **x402 Payment Headers**: Specifying target payment chain in `X-PAYMENT-REQUIRED` headers (e.g. `network: "stellar:testnet"`).
- **Wallet Session Binding**: Distinguishing wallet sessions and session key permissions across multi-chain environments.
- **RPC & Explorer Routing**: Mapping network requests to appropriate Horizon and Soroban RPC nodes.

## Run it

```sh
npx tsx contrib/examples/list-caip2-ids/list-caip2-ids.ts
```

## Tests

```sh
npx vitest run contrib/examples/list-caip2-ids
```
