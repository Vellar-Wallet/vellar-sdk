// Core domain types for the VELA wallet SDK. Self-contained — the SDK carries
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
