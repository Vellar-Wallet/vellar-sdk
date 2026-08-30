// Example: connect to an existing wallet by keyId against a small in-file
// mock backend, and print the resolved session.
//
// Run with: npx tsx connect-wallet.ts

export interface MockBackendRecord {
  contractId: string;
}

/** A tiny stand-in for the real WalletBackend.lookupContractId round trip. */
export class MockWalletBackend {
  #byKeyId: Map<string, MockBackendRecord>;

  constructor(seed: Record<string, MockBackendRecord>) {
    this.#byKeyId = new Map(Object.entries(seed));
  }

  async lookupContractId(keyId: string): Promise<MockBackendRecord | undefined> {
    return this.#byKeyId.get(keyId);
  }
}

export interface ConnectResult {
  accountId: string;
  keyId: string;
  connected: true;
}

export async function connectWallet(
  backend: MockWalletBackend,
  keyId: string,
): Promise<ConnectResult> {
  const record = await backend.lookupContractId(keyId);
  if (!record) {
    throw new Error(`connectWallet: no wallet is registered for keyId "${keyId}"`);
  }
  return { accountId: record.contractId, keyId, connected: true };
}

async function main() {
  const backend = new MockWalletBackend({
    "keyid-known-abc123": { contractId: "CABC123KNOWNWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXX" },
  });

  // Known keyId: resolves and prints the session.
  const session = await connectWallet(backend, "keyid-known-abc123");
  console.log("Connected:", session);

  // Unknown keyId: caught and reported clearly, not a raw stack trace.
  const unknownKeyId = "keyid-unknown-does-not-exist";
  try {
    await connectWallet(backend, unknownKeyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`Could not connect: ${message}`);
  }
}

// Only run when executed directly (not when imported by the test file).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
