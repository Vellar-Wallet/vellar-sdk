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
  /** Optional correlation ID for cross-boundary tracing in backend logs. */
  correlationId?: string;
}

export interface SignTransactionInput {
  xdr: string;
  network: Network;
}

// --- Shared Observability & Retry Hooks ---

export interface RetryPayload {
  /** The 1-based attempt number for this retry sequence. */
  attempt: number;
  /** The error or rejection that triggered the retry, if available. */
  error?: unknown;
  /** Name or identifier of the operation/callsite retrying. */
  operation?: string;
  /** Arbitrary structured contextual metadata (e.g. transaction hash, status, url). */
  [key: string]: unknown;
}

export type OnRetryHook = (payload: RetryPayload) => void | Promise<void>;

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
