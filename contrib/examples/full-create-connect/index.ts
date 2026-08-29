/**
 * Reference example: full create and connect wallet flow with mocked passkey kit
 * and backend dependencies.
 *
 * Demonstrates:
 * - Creating a new wallet (passkey registration + backend submission)
 * - Simulating a page reload
 * - Reconnecting using the resulting keyId
 */

import type { WalletSession } from "../../../src/types";

export interface MockPasskeyKitLike {
  createWallet(app: string, user: string): Promise<{ keyIdBase64: string; contractId: string; signedTx: unknown }>;
  connectWallet(opts?: { keyId?: string }): Promise<{ keyIdBase64: string; contractId: string }>;
  wallet?: unknown;
}

export interface MockBackend {
  submitWalletCreation(input: { keyId: string; contractId: string; network: string; signedTx: unknown }): Promise<{ sessionId: string }>;
  lookupContractId(input: { keyId: string; network: string }): Promise<{ contractId: string; sessionId: string } | undefined>;
}

export function createMockPasskeyKit(): MockPasskeyKitLike {
  return {
    wallet: undefined,
    async createWallet() {
      return {
        keyIdBase64: "key-" + Math.random().toString(36).slice(2, 10),
        contractId: "C" + "A".repeat(55),
        signedTx: "AAAA...",
      };
    },
    async connectWallet(opts) {
      return {
        keyIdBase64: opts?.keyId ?? "key-reconnected",
        contractId: "C" + "B".repeat(55),
      };
    },
  };
}

export function createMockBackend(): MockBackend {
  return {
    async submitWalletCreation() {
      return { sessionId: "sess-" + Math.random().toString(36).slice(2, 10) };
    },
    async lookupContractId(input) {
      return { contractId: "C" + "B".repeat(55), sessionId: "sess-restored" };
    },
  };
}

export function createWalletSession(contractId: string, keyId: string | undefined, sessionId: string | undefined): WalletSession {
  return {
    accountId: contractId,
    network: "testnet",
    connected: true,
    authMethod: "passkey",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    ...(keyId !== undefined && { keyId }),
    ...(sessionId !== undefined && { serverSessionId: sessionId }),
  };
}