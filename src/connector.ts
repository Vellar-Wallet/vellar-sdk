import type { CreateWalletInput, Network, SignTransactionInput, WalletSession } from "./types";

// The seam that isolates the smart-account/passkey implementation choice
// (idea.md §6.1 WalletConnector). UI and session code depend only on this
// interface; the concrete connector (PasskeyKit-backed, custom contract, ...)
// plugs in underneath without touching callers.

export interface SignedTransaction {
  signedXdr: string;
}

export interface WalletConnector {
  /** Register a passkey and create/initialize the smart account (idea.md §6.1 create flow). */
  createWallet(input: CreateWalletInput): Promise<WalletSession>;
  /** Authenticate with an existing passkey and restore the account mapping (reconnect flow). */
  connectWallet(network: Network): Promise<WalletSession>;
  /** Produce a signature/auth for a reviewed transaction (sign flow). */
  signTransaction(input: SignTransactionInput): Promise<SignedTransaction>;
}
