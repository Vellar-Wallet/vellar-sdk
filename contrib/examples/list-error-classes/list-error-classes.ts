// Example: list the SDK's typed error classes with a one-line description
// of when each is thrown. Hardcoded — kept in sync with the SDK source
// manually (see the README note).
//
// Run with: npx tsx list-error-classes.ts

export interface ErrorClassInfo {
  name: string;
  description: string;
}

export const SDK_ERROR_CLASSES: ErrorClassInfo[] = [
  { name: "WalletNotReadyError", description: "wallet.pay()/wallet.policies used before create() or connect()" },
  { name: "WalletNetworkMismatchError", description: "the connector is configured for one network but asked to operate on another" },
  { name: "InvalidRecipientError", description: "a payment recipient is invalid or equals the sender" },
  { name: "InvalidAmountError", description: "a payment/token amount string is malformed, zero, or negative" },
  { name: "WalletApiError", description: "an HTTP call to the wallet gateway (create/connect/submit) returned a non-2xx response" },
  { name: "PolicyApiError", description: "an HTTP call to the policy API gateway returned a non-2xx response" },
  { name: "TransactionTimeoutError", description: "waitForTransaction() polled past its timeout without a final status" },
  { name: "MaxAmountExceededError", description: "an x402 server requested more than the caller's maxAmount" },
  { name: "DisallowedAssetError", description: "an x402 server requested an asset not in the caller's allowedAssets" },
  { name: "X402NotConfiguredError", description: "wallet.x402 was used without x402 config in createVellarWallet" },
];

function main() {
  for (const { name, description } of SDK_ERROR_CLASSES) {
    console.log(`${name}: ${description}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
