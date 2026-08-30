// Example: a mock end-to-end WalletBackend — create, connect, and
// submitTransaction — backed by an in-memory ledger of submitted
// transactions queryable by hash, wired into a real createVellarWallet for
// a full create-then-pay sequence with no live network call.
//
// Run with: npx tsx mock-full-backend.ts

import { createVellarWallet, type VellarWallet } from "../../../src/client";
import type { PasskeyKitLike, WalletBackend } from "../../../src/passkeykit-connector";
import type { SacClientLike, TokenContractClientLike } from "../../../src/payments-client";
import type { Network } from "../../../src/types";
import type { TokenInfo } from "../../../src/balances";

export interface LedgerEntry {
  hash: string;
  signedXdr: string;
  network: Network;
  submittedAt: string;
}

export interface MockWalletBackend extends WalletBackend {
  submitTransaction(input: { signedXdr: string; network: Network }): Promise<{ hash: string }>;
  /** Looks up a previously submitted transaction by the hash returned from
   * submitTransaction. Undefined if no such hash was ever submitted. */
  getTransaction(hash: string): LedgerEntry | undefined;
  /** Every transaction submitted so far, oldest first. */
  listTransactions(): LedgerEntry[];
}

/**
 * Builds a fully in-memory WalletBackend: wallet creation always succeeds
 * with a fresh session id, and every submitted transaction is recorded in
 * an append-only ledger, queryable by its hash. No network I/O.
 */
export function createMockWalletBackend(): MockWalletBackend {
  const ledger: LedgerEntry[] = [];
  let nextHash = 1;

  return {
    async submitWalletCreation(input) {
      return { sessionId: `session-${input.keyId}` };
    },
    async lookupContractId() {
      // This example only exercises the create flow, not reconnect; a
      // reconnect-focused example would populate a keyId->contractId map here.
      return undefined;
    },
    async submitTransaction(input) {
      const hash = `mocktxhash${nextHash++}`.padEnd(16, "0");
      ledger.push({ hash, signedXdr: input.signedXdr, network: input.network, submittedAt: new Date().toISOString() });
      return { hash };
    },
    getTransaction(hash) {
      return ledger.find((entry) => entry.hash === hash);
    },
    listTransactions() {
      return [...ledger];
    },
  };
}

/** A minimal mock PasskeyKitLike + SacClientLike, just enough to complete a
 * create-then-pay sequence against the mock backend above. */
function createMockKitAndSac(): { kit: PasskeyKitLike; sac: SacClientLike } {
  const kit: PasskeyKitLike = {
    async createWallet(_app, _user) {
      return {
        keyIdBase64: "mock-key-id",
        contractId: "CMOCKSMARTACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        signedTx: "mock-create-tx",
      };
    },
    async connectWallet() {
      return { keyIdBase64: "mock-key-id", contractId: "CMOCKSMARTACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" };
    },
    async sign(tx: unknown) {
      return typeof tx === "string" ? `signed:${tx}` : "signed:mock-payment-tx";
    },
  };

  const sac: SacClientLike = {
    getSACClient(tokenContractId: string): TokenContractClientLike {
      return {
        async transfer() {
          return `unsigned-transfer-tx:${tokenContractId}`;
        },
      };
    },
  };

  return { kit, sac };
}

export function createMockVellarWallet(network: Network): { wallet: VellarWallet; backend: MockWalletBackend } {
  const backend = createMockWalletBackend();
  const { kit, sac } = createMockKitAndSac();

  const wallet = createVellarWallet({
    network,
    appName: "mock-full-backend example",
    kit,
    backend,
    sac,
    isValidAddress: (address: string) => address.length > 0,
  });

  return { wallet, backend };
}

async function main() {
  const log = (line: string) => console.log(line);
  const { wallet, backend } = createMockVellarWallet("testnet");

  log("Step 1: create the wallet");
  const session = await wallet.create({ username: "demo-user" });
  log(`  session.accountId = ${session.accountId}`);

  const token: TokenInfo = { symbol: "USDC", contractId: "CUSDCMOCK", decimals: 7 };

  log("Step 2: send a payment");
  const first = await wallet.pay({ to: "GRECIPIENT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", amount: 10_0000000n, token });
  log(`  submitted, hash = ${first.hash}`);

  log("Step 3: send a second payment");
  const second = await wallet.pay({ to: "GRECIPIENT2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", amount: 5_0000000n, token });
  log(`  submitted, hash = ${second.hash}`);

  log("Step 4: query the ledger by hash");
  log(`  getTransaction(first.hash) -> ${JSON.stringify(backend.getTransaction(first.hash))}`);

  log("Step 5: list every submitted transaction");
  log(`  listTransactions() has ${backend.listTransactions().length} entries`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
