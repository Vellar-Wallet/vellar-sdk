import { describe, expect, it } from "vitest";
import { createWalletWithDefaults } from "./wallet-with-defaults";

function mockKit() {
  return {
    async createWallet(_app: string, user: string) {
      return { keyIdBase64: `keyid-${user}`, contractId: "CMOCK", signedTx: "mock-tx" };
    },
    async connectWallet() {
      throw new Error("not used");
    },
    async sign(tx: unknown) {
      return tx;
    },
  };
}

function mockBackend() {
  return {
    async submitWalletCreation() {
      return { sessionId: "sess_1" };
    },
    async lookupContractId() {
      return undefined;
    },
    async submitTransaction() {
      return { hash: "tx_1" };
    },
  };
}

const mockSac = { getSACClient: () => ({ transfer: async () => "mock-tx" }) };

describe("createWalletWithDefaults", () => {
  it("produces a working wallet handle with just kit, backend, and sac", async () => {
    const wallet = createWalletWithDefaults({ kit: mockKit(), backend: mockBackend(), sac: mockSac });
    const session = await wallet.create({ username: "Test User" });
    expect(session.network).toBe("testnet");
    expect(session.accountId).toBe("CMOCK");
  });

  it("allows overriding a default (network)", async () => {
    const wallet = createWalletWithDefaults({
      kit: mockKit(),
      backend: mockBackend(),
      sac: mockSac,
      network: "mainnet",
    });
    const session = await wallet.create({ username: "Test User" });
    expect(session.network).toBe("mainnet");
  });

  it("allows overriding the default isValidAddress", async () => {
    const wallet = createWalletWithDefaults({
      kit: mockKit(),
      backend: mockBackend(),
      sac: mockSac,
      isValidAddress: () => false, // reject every address, including well-formed ones
    });
    await wallet.create({ username: "Test User" });

    // The default isValidAddress would accept a well-formed classic address;
    // the override rejects everything, so preparePayment must fail here —
    // proving the override, not the default, is what's actually wired in.
    await expect(
      wallet.pay({
        to: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        amount: 100n,
        token: { symbol: "XLM", contractId: "CNATIVE", decimals: 7 },
      }),
    ).rejects.toThrow(/not a valid Stellar address/);
  });
});
