/** Canonical stable v1 export names — keep in sync with README and index.ts. */
export const STABLE_V1_EXPORTS = [
  "createVellarWallet",
  "WalletNotReadyError",
  "TESTNET",
  "MAINNET",
  "mainnetConfig",
  "MainnetConfigError",
  "createHttpWalletBackend",
  "WalletApiError",
  "createBalanceService",
  "fetchBalancesBatch",
  "formatTokenAmount",
  "BatchBalanceSizeError",
  "MAX_BATCH_BALANCE_SIZE",
  "createPasskeyKitConnector",
  "createPaymentClient",
  "createPolicyClient",
  "createPolicyFacade",
  "createAgentsFacade",
  "createSessionStore",
  "waitForTransaction",
  "PolicyListFilterError",
] as const;

/** Canonical experimental export names — keep in sync with README and index.ts. */
export const EXPERIMENTAL_EXPORTS = [
  "createSessionKeySigner",
  "createPasskeyX402Signer",
  "createX402Client",
  "createX402Facade",
  "X402NotConfiguredError",
  "MaxAmountExceededError",
] as const;
