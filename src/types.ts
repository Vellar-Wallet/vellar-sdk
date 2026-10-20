// Core domain types for the Vellar wallet SDK. Self-contained — the SDK carries
// its own copy so it installs with no workspace/monorepo dependency.

export type Network = "testnet" | "mainnet";

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

/**
 * Defines the rules for a smart account policy contract.
 * `owners` must contain unique addresses — duplicates are rejected by
 * `PolicyFacade.generate()` before any RPC or passkey interaction.
 * Stellar addresses are case-sensitive in their base32 encoding, so
 * "GABC…" and "gabc…" are treated as distinct addresses by the network
 * but are rejected as a likely mistake if the same canonical form repeats.
 */
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
