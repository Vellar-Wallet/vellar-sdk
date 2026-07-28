# Error to Message

A self-contained example module that maps known Vellar SDK error class
instances to short, friendly display strings for a UI.

Contributed for [issue #55](https://github.com/Vellar-Wallet/vellar-sdk/issues/55).

---

## Overview

`error-to-message.ts` exports a single function:

```ts
function sdkErrorToMessage(err: unknown): string
```

Pass anything your `catch` block receives — a known SDK error, a plain
`Error`, a string, `null`, anything. It always returns a human-readable
sentence safe to show in a toast, banner, or form field.

### Covered error classes

| Error class | User-facing message theme |
|---|---|
| `WalletNotReadyError` | Connect your wallet first |
| `WalletNetworkMismatchError` | Network mismatch between wallet and app |
| `InvalidAmountError` | Invalid payment amount |
| `InvalidRecipientError` | Invalid recipient address |
| `MainnetConfigError` | Mainnet configuration incomplete |
| `PolicyApiError` | Policy service error (status-aware: network, auth, not-found, server, generic) |
| `X402NotConfiguredError` | x402 agentic payments not configured |
| `MaxAmountExceededError` | Server requested more than your set limit |
| `DisallowedAssetError` | Server requested a token not on your allow-list |
| `NoUsablePaymentOptionError` | No compatible payment option available |
| `PaymentRejectedError` | Payment declined (spending limit / facilitator rejection) |
| `InvalidRequirementsError` | Server sent a malformed payment request |
| _anything else_ | Generic fallback — never exposes internal detail |

---

## Usage

```ts
import { sdkErrorToMessage } from "./error-to-message";
// In your real app, also import the SDK error classes from "vellar-sdk":
//   import { WalletNotReadyError, ... } from "vellar-sdk";

try {
  await wallet.pay({ to, amount, token });
} catch (err) {
  // Always safe to show — no raw stack traces or internal messages.
  showToast(sdkErrorToMessage(err));
}
```

### Per-component example

```ts
try {
  await wallet.connect();
} catch (err) {
  setErrorMessage(sdkErrorToMessage(err));
}
```

---

## Running the tests

The tests use [vitest](https://vitest.dev/), already a dev dependency of the repo.

```bash
# Run just this example's tests (from the repo root)
npx vitest run contrib/examples/issue-55-error-to-message/error-to-message.test.ts
```

Or run the full suite:

```bash
npm test
```

Expected output:

```
 ✓ contrib/examples/issue-55-error-to-message/error-to-message.test.ts (24)
   ✓ sdkErrorToMessage — known SDK errors > WalletNotReadyError → prompt to connect
   ✓ sdkErrorToMessage — known SDK errors > WalletNetworkMismatchError → network mismatch message
   ✓ sdkErrorToMessage — known SDK errors > InvalidAmountError → amount guidance
   ✓ sdkErrorToMessage — known SDK errors > InvalidRecipientError → recipient guidance
   ✓ sdkErrorToMessage — known SDK errors > MainnetConfigError → config guidance
   ✓ sdkErrorToMessage — known SDK errors > PolicyApiError > status 0 → network connectivity message
   ✓ sdkErrorToMessage — known SDK errors > PolicyApiError > status 401 → access denied message
   ✓ sdkErrorToMessage — known SDK errors > PolicyApiError > status 403 → access denied message
   ✓ sdkErrorToMessage — known SDK errors > PolicyApiError > status 404 → not found message
   ✓ sdkErrorToMessage — known SDK errors > PolicyApiError > status 500 → service unavailable message
   ✓ sdkErrorToMessage — known SDK errors > PolicyApiError > other status → generic policy message
   ✓ sdkErrorToMessage — known SDK errors > X402NotConfiguredError → x402 setup guidance
   ✓ sdkErrorToMessage — known SDK errors > MaxAmountExceededError → amount limit message
   ✓ sdkErrorToMessage — known SDK errors > DisallowedAssetError → disallowed token message
   ✓ sdkErrorToMessage — known SDK errors > NoUsablePaymentOptionError → no compatible option message
   ✓ sdkErrorToMessage — known SDK errors > PaymentRejectedError → payment declined message
   ✓ sdkErrorToMessage — known SDK errors > InvalidRequirementsError → bad server request message
   ✓ sdkErrorToMessage — unknown / generic error types > plain Error → generic fallback
   ✓ sdkErrorToMessage — unknown / generic error types > string throw → generic fallback
   ✓ sdkErrorToMessage — unknown / generic error types > null throw → generic fallback
   ✓ sdkErrorToMessage — unknown / generic error types > undefined throw → generic fallback
   ✓ sdkErrorToMessage — unknown / generic error types > number throw → generic fallback
   ✓ sdkErrorToMessage — unknown / generic error types > custom error class not in SDK → generic fallback

 Test Files  1 passed (1)
 Tests       23 passed (23)
```

---

## File structure

```
contrib/examples/issue-55-error-to-message/
├── README.md                  ← you are here
├── error-to-message.ts        ← the module
└── error-to-message.test.ts   ← vitest tests
```
