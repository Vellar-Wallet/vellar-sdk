// Example: a mock PasskeyKitLike returning fixed, documented canned
// responses for createWallet, connectWallet, and sign — for headless tests
// that need a createVellarWallet() kit without a real WebAuthn ceremony or
// browser feature.
//
// Run with: npx tsx mock-passkey-kit.ts

import { createVellarWallet, type PasskeyKitLike } from "../../../src/index";

export const CANNED_KEY_ID = "mock-keyid-canned";
export const CANNED_CONTRACT_ID = "CMOCKPASSKEYKITCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXX";

/**
 * A mock PasskeyKitLike for headless tests: every call resolves immediately
 * with a fixed, documented response — never a real WebAuthn prompt or
 * browser API.
 *
 *   - createWallet  → { keyIdBase64: CANNED_KEY_ID, contractId: CANNED_CONTRACT_ID, signedTx: "mock-signed-deployment-tx" }
 *   - connectWallet → { keyIdBase64: CANNED_KEY_ID, contractId: CANNED_CONTRACT_ID }
 *   - sign          → returns the input transaction unchanged (a no-op "signature")
 */
export function createMockPasskeyKit(): PasskeyKitLike {
  return {
    async createWallet() {
      return {
        keyIdBase64: CANNED_KEY_ID,
        contractId: CANNED_CONTRACT_ID,
        signedTx: "mock-signed-deployment-tx",
      };
    },
    async connectWallet() {
      return { keyIdBase64: CANNED_KEY_ID, contractId: CANNED_CONTRACT_ID };
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
    backend: {
      async submitWalletCreation() {
        return { sessionId: "mock-session-id" };
      },
      async lookupContractId() {
        return undefined;
      },
      async submitTransaction() {
        return { hash: "mock-tx-hash" };
      },
    },
    sac: { getSACClient: () => ({ transfer: async () => "mock-tx" }) },
    isValidAddress: () => true,
  });

  const session = await wallet.create({ username: "Headless Test User" });
  console.log("Wired mock passkey kit into createVellarWallet(); session:", session);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
