# Errors

Every error the SDK throws across its public surface extends `VellarError`,
so you can catch broadly or narrow to a specific class — never string-match
`error.message`. Raw `fetch` failures and other lower-level exceptions are
wrapped before they reach you.

```ts
import { VellarError, WalletNotReadyError, WalletApiError } from "vellar-sdk";

try {
  await vellar.pay({ to, amount, token });
} catch (err) {
  if (err instanceof WalletNotReadyError) {
    // call create() or connect() first
  } else if (err instanceof WalletApiError) {
    // err.status, err.code — your backend rejected the request
  } else if (err instanceof VellarError) {
    // any other typed SDK failure
  } else {
    throw err; // not ours
  }
}
```

## Catalog

| Class | Thrown when | Extra properties |
| --- | --- | --- |
| `WalletNotReadyError` | A method needs a session but `create()`/`connect()` hasn't run yet | — |
| `InvalidRecipientError` | A payment or payment-URI destination is malformed | — |
| `InvalidAmountError` | An amount is malformed, zero, negative, or over-precise | — |
| `InvalidAssetError` | A payment URI's `assetCode`/`assetIssuer` is malformed or incomplete | — |
| `WalletApiError` | Your wallet backend (`/wallet/*`) returned a non-2xx response, or the request itself failed (network down: `status` is `0`) | `status`, `code` |
| `WalletNetworkMismatchError` | The connector is configured for one network but asked to operate on another | — |
| `SignedTransactionError` | The SDK couldn't convert a signed transaction to XDR | — |
| `MainnetConfigError` | `mainnetConfig()` is missing/malformed `rpcUrl` or `walletWasmHash` | — |
| `RpcRequestError` | A direct Soroban RPC call failed ([`vellar-sdk/rpc`](./advanced.md) balance/tx-status readers) | — |
| `TransactionTimeoutError` | `waitForTransaction()` timed out before a final status | — |
| `PolicyApiError` | Your policy backend (`/policies/*`) returned a non-2xx response, or the request itself failed | `status`, `errors` |
| `PolicyNotDeployableError` | [`policies.deploy()`](./policies.md) was called without a `policyAttach` runtime configured | — |
| `X402NotConfiguredError` | `wallet.x402` was used without `x402` config | — |
| `X402PaymentError` | An [x402](./x402.md) payment couldn't be built or sent (simulation, expired auth entry, non-replayable body) | — |
| `X402SigningError` (extends `X402PaymentError`) | An x402 signer was misconfigured, or asked to sign an entry it can't | — |
| `MaxAmountExceededError` | The x402 server asked for more than `maxAmount` | `required`, `maxAmount`, `asset` |
| `DisallowedAssetError` | The x402 server asked for an asset not in `allowedAssets` | `asset`, `allowedAssets` |
| `NoUsablePaymentOptionError` | The 402 offered no payment option this client can satisfy | — |
| `InvalidRequirementsError` | An x402 payment requirement from the server was malformed | — |
| `PaymentRejectedError` | The x402 facilitator rejected the payment at verify time | `reason` |

For the exact shape of each class, see the [generated API reference](/api/index.html).
