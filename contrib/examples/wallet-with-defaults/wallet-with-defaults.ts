// Example: wrap createVellarWallet with sane testnet defaults, so callers
// only need to supply a kit and a backend. Any default may still be
// overridden.
//
// Run with: npx tsx wallet-with-defaults.ts

import { StrKey } from "@stellar/stellar-sdk";
import { createVellarWallet, type VellarWallet, type VellarWalletConfig } from "../../../src/index";

/**
 * The subset of VellarWalletConfig a caller must always supply — the rest
 * gets sane testnet defaults below.
 *
 * `sac` is required, not defaulted: there is no safe stand-in for the real
 * SAC client — a stub that throws breaks payments unexpectedly, and a stub
 * that succeeds silently would fake a payment working. Both are worse than
 * asking the caller for it explicitly.
 */
export type MinimalWalletConfig = Pick<VellarWalletConfig, "kit" | "backend" | "sac"> &
  Partial<Omit<VellarWalletConfig, "kit" | "backend" | "sac">>;

function defaultIsValidAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);
}

/**
 * createVellarWallet with defaults filled in: network="testnet",
 * appName="vellar-example", and an isValidAddress that accepts both
 * classic (G...) and contract (C...) addresses. Every default can still be
 * overridden by passing it explicitly.
 */
export function createWalletWithDefaults(config: MinimalWalletConfig): VellarWallet {
  return createVellarWallet({
    network: "testnet",
    appName: "vellar-example",
    isValidAddress: defaultIsValidAddress,
    ...config,
  });
}

async function main() {
  const wallet = createWalletWithDefaults({
    kit: {
      async createWallet(_app, user) {
        return {
          keyIdBase64: `mock-keyid-${user.toLowerCase().replace(/\s+/g, "-")}`,
          contractId: "CMOCKWALLETWITHDEFAULTSCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXX",
          signedTx: "mock-signed-deployment-tx",
        };
      },
      async connectWallet() {
        throw new Error("mock kit: connectWallet is not used by this example");
      },
      async sign(tx) {
        return tx;
      },
    },
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
  });

  const session = await wallet.create({ username: "Defaults Example User" });
  console.log("Created wallet with defaults; session:", session);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
