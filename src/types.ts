// Core domain types for the Vellar wallet SDK. Self-contained — the SDK carries
// its own copy so it installs with no workspace/monorepo dependency.

export type Network = "testnet" | "mainnet";

// --- Address validation ---

/**
 * Caller-supplied Stellar address validator (e.g. wrap
 * `StrKey.isValidEd25519PublicKey` / `StrKey.isValidContract`).
 *
 * Contract: return `true` for a valid address and `false` for an invalid one.
 * Implementations MUST NOT throw — an invalid address is a `false`, not an
 * exception. The SDK does not catch a throwing validator: the error propagates
 * unchanged out of `wallet.pay()` (before any transaction is built or any
 * passkey prompt), so it surfaces as the validator's own error rather than as
 * an "invalid recipient" result, and nothing is signed or submitted.
 */
export type AddressValidator = (address: string) => boolean;

// --- Passkey wallet ---

export interface WalletSession {
  accountId: string;
  network: Network;
  connected: boolean;
  authMethod: "passkey";
  createdAt: string;
  lastActiveAt: string;
  /** Server-side session record id — lets a UI mark "this device". */
  serverSessionId?: string;
  /**
   * The passkey's base64url credential id: lets a fresh page resume the kit
   * connection without a WebAuthn prompt (connectWallet({ keyId }) skips the
   * discovery ceremony). Public data.
   */
  keyId?: string;
}

export interface CreateWalletInput {
  username?: string;
  network: Network;
}

export interface SignTransactionInput {
  xdr: string;
  network: Network;
}

// --- Smart Account Policy Builder ---

export interface PolicyDefinition {
  version: string;
  type: string;
  owners: string[];
  threshold?: number;
  spendingLimits?: {
    dailyXlm?: string;
    perTxXlm?: string;
  };
  allowlistedContracts?: string[];
  timelocks?: {
    adminActionDelaySeconds?: number;
  };
}
