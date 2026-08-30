# List testnet asset codes

Prints a fixed list of common testnet asset codes useful for manual testing,
as a simple formatted table.

> **This is a static reference list, not a live query.** The SDK has no
> "list assets" endpoint, and testnet issuers/liquidity change over time —
> verify an asset (and its issuer) still exists on testnet before relying on
> it in a real test.

## Run it

```sh
npx tsx list-testnet-assets.ts
```

Expected output:

```
CODE   DESCRIPTION
------------------
XLM    Native Stellar Lumens — no issuer, always available
USDC   Circle's testnet USD Coin, widely used for payment demos
yUSDC  Yield-bearing wrapped testnet USDC used in some DeFi demos
SRT    Common StellarX testnet reward/test token
TEST   Generic placeholder code many sample issuers mint for demos
BTC    Testnet-issued synthetic Bitcoin-pegged asset used in anchor demos

Static reference list — not a live query. Verify an asset/issuer still exists on testnet before use.
```

## Tests

```sh
npx vitest run contrib/examples/list-testnet-assets
```
