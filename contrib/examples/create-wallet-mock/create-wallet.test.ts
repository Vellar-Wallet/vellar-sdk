import { describe, expect, it } from "vitest";
import { createVellarWallet } from "../../../src/index";
import { createMockBackend, createMockPasskeyKit } from "./create-wallet";

describe("createVellarWallet with a mocked passkey kit", () => {
  it("creates a wallet and returns a session with accountId and keyId", async () => {
    const wallet = createVellarWallet({
      network: "testnet",
      appName: "vellar-example-test",
      kit: createMockPasskeyKit(),
      backend: createMockBackend(),
      sac: { getSACClient: () => ({ transfer: async () => "mock-tx" }) },
      isValidAddress: () => true,
    });

    const session = await wallet.create({ username: "Test User" });

    expect(session.accountId).toBe(
      "CMOCKWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    );
    expect(session.keyId).toBe("mock-keyid-test-user");
    expect(session.connected).toBe(true);
    expect(session.network).toBe("testnet");
  });
});
