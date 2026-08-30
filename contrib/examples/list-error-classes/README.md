# List the SDK's typed error classes

Prints the SDK's typed error class names with a one-line description of when
each is thrown — a quick reference for `try`/`catch` handling without
digging through the source.

> **This list is hardcoded and must be kept in sync with the SDK source
> manually.** It is not generated or validated against `src/` — if a new
> error class is added, or an existing one renamed, this list will drift
> until someone updates it by hand.

## Run it

```sh
npx tsx list-error-classes.ts
```

Expected output (10 entries):

```
WalletNotReadyError: wallet.pay()/wallet.policies used before create() or connect()
WalletNetworkMismatchError: the connector is configured for one network but asked to operate on another
InvalidRecipientError: a payment recipient is invalid or equals the sender
InvalidAmountError: a payment/token amount string is malformed, zero, or negative
WalletApiError: an HTTP call to the wallet gateway (create/connect/submit) returned a non-2xx response
PolicyApiError: an HTTP call to the policy API gateway returned a non-2xx response
TransactionTimeoutError: waitForTransaction() polled past its timeout without a final status
MaxAmountExceededError: an x402 server requested more than the caller's maxAmount
DisallowedAssetError: an x402 server requested an asset not in the caller's allowedAssets
X402NotConfiguredError: wallet.x402 was used without x402 config in createVellarWallet
```

## Tests

```sh
npx vitest run contrib/examples/list-error-classes
```
