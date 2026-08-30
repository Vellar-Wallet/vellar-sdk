// Example: a mock WalletBackend returning fixed, documented canned responses
// for create, connect, and submit — for offline tests that need a
// createVellarWallet() backend without a real gateway.
//
// Run with: npx tsx mock-wallet-backend.ts

import { createVellarWallet, type PasskeyKitLike, type WalletBackend } from "../../../src/index";

export const CANNED_SESSION_ID = "mock-session-id-canned";
export const CANNED_CONTRACT_ID = "CMOCKBACKENDCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
export const CANNED_TX_HASH = "mock-tx-hash-canned";

/**
 * A mock WalletBackend for offline tests: every call resolves immediately
 * with a fixed, documented response instead of making a network request.
 *
 *   - submitWalletCreation → { sessionId: CANNED_SESSION_ID }
 *   - lookupContractId     → { contractId: CANNED_CONTRACT_ID, sessionId: CANNED_SESSION_ID }
 *   - submitTransaction    → { hash: CANNED_TX_HASH }
 */
export function createMockWalletBackend(): WalletBackend & {
  submitTransaction(input: {
    signedXdr: string;
    network: "testnet" | "mainnet";
  }): Promise<{ hash: string }>;
} {
  return {
    async submitWalletCreation() {
      return { sessionId: CANNED_SESSION_ID };
    },
    async lookupContractId() {
      return { contractId: CANNED_CONTRACT_ID, sessionId: CANNED_SESSION_ID };
    },
    async submitTransaction() {
      return { hash: CANNED_TX_HASH };
    },
  };
}

/** A minimal PasskeyKit stand-in, just enough to drive create()/connect(). */
function createMockPasskeyKit(): PasskeyKitLike {
  return {
    async createWallet(_app: string, user: string) {
      return {
        keyIdBase64: `mock-keyid-${user.toLowerCase().replace(/\s+/g, "-")}`,
        contractId: CANNED_CONTRACT_ID,
        signedTx: "mock-signed-deployment-tx",
      };
    },
    async connectWallet() {
      return { keyIdBase64: "mock-keyid-reconnect", contractId: CANNED_CONTRACT_ID };
    },
    async sign(tx: unknown) {
      return tx;
    },
  };
}

async function main() {
  const wallet = createVellarWallet({
    network: "testnet",
    appName: "vellar-example",
    kit: createMockPasskeyKit(),
    backend: createMockWalletBackend(),
    sac: { getSACClient: () => ({ transfer: async () => "mock-tx" }) },
    isValidAddress: () => true,
  });

  const session = await wallet.create({ username: "Offline Test User" });
  console.log("Wired mock backend into createVellarWallet(); session:", session);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
