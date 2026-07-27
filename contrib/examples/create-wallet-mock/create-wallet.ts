// Example: call the real createVellarWallet() with a small in-file mocked
// PasskeyKit and backend (no real WebAuthn prompt, no network call), and
// print the resulting session's accountId and keyId.
//
// Run with: npx tsx create-wallet.ts

import { createVellarWallet, type PasskeyKitLike, type WalletBackend } from "../../../src/index";

/** A minimal PasskeyKit stand-in: "creates" a wallet by returning fixed,
 * deterministic identifiers instead of prompting WebAuthn. */
function createMockPasskeyKit(): PasskeyKitLike {
  return {
    async createWallet(_app: string, user: string) {
      return {
        keyIdBase64: `mock-keyid-${user.toLowerCase().replace(/\s+/g, "-")}`,
        contractId: "CMOCKWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        signedTx: "mock-signed-deployment-tx",
      };
    },
    async connectWallet() {
      throw new Error("mock kit: connectWallet is not used by this example");
    },
    async sign(tx: unknown) {
      return tx;
    },
  };
}

/** A minimal backend stand-in: accepts the deployment and hands back a
 * session id, without ever touching a real gateway. */
function createMockBackend(): WalletBackend & {
  submitTransaction(input: { signedXdr: string; network: "testnet" | "mainnet" }): Promise<{ hash: string }>;
} {
  return {
    async submitWalletCreation() {
      return { sessionId: "mock-session-id" };
    },
    async lookupContractId() {
      return undefined;
    },
    async submitTransaction() {
      return { hash: "mock-tx-hash" };
    },
  };
}

async function main() {
  const wallet = createVellarWallet({
    network: "testnet",
    appName: "vellar-example",
    kit: createMockPasskeyKit(),
    backend: createMockBackend(),
    sac: { getSACClient: () => ({ transfer: async () => "mock-tx" }) },
    isValidAddress: () => true,
  });

  const session = await wallet.create({ username: "Example User" });
  console.log("accountId:", session.accountId);
  console.log("keyId:    ", session.keyId);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { createMockPasskeyKit, createMockBackend };
