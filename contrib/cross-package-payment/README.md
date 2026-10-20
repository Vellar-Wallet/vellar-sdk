# CLI and MCP payer settlement parity

This opt-in integration contract pays one deterministic demo resource through
the actual `vellar pay` command path, then through MCP `payAndCall`. It compares
the reported amount and 64-hex transaction hash and verifies the MCP spend
ledger records the same amount exactly once. The network, signer, facilitator,
and resource are hermetic fakes; no key is persisted and no funds move.

The test is excluded by the root Vitest configuration and requires an explicit
gate, matching the repository's integration-test policy:

```sh
VELLAR_CROSS_PACKAGE_INTEGRATION=1 npx vitest run --config contrib/cross-package-payment/vitest.config.ts
```

PowerShell:

```powershell
$env:VELLAR_CROSS_PACKAGE_INTEGRATION = "1"
npx vitest run --config contrib/cross-package-payment/vitest.config.ts
Remove-Item Env:VELLAR_CROSS_PACKAGE_INTEGRATION
```
