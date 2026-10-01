# Configurable Expiration Estimate

Standalone reference and tests for issue #508. This helper is not imported by or exported from `vellar-sdk`.

## Pubnet measurement

Measured 2026-09-30 from `https://horizon.stellar.org/ledgers?order=desc&limit=100`. The method was to parse `closed_at`, order the 100 ledger records by sequence, and calculate the 99 adjacent close-time differences. All 99 intervals were 5 seconds: mean 5, median 5, p90 5, minimum 5, maximum 5. The default estimate remains 5 seconds, with `ledgerSecondsEstimate` available to configure another network.

## Run

```sh
npx vitest run contrib/issue-508-expiration-override/expiration.test.ts
```

The candidate client config is `ledgerSecondsEstimate?: number`. Forward it from `VellarWalletConfig.x402` to the expiration helper. Keep the independent safety margin, minimum, and seller-timeout maximum intact; the estimate only changes the conversion from seconds to ledgers.