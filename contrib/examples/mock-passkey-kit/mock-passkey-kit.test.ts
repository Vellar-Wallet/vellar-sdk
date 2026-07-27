import { describe, expect, it } from "vitest";
import { CANNED_CONTRACT_ID, CANNED_KEY_ID, createMockPasskeyKit } from "./mock-passkey-kit";

describe("createMockPasskeyKit", () => {
  it("createWallet returns the canned keyId, contractId, and a signed tx", async () => {
    const kit = createMockPasskeyKit();
    await expect(kit.createWallet("app", "user")).resolves.toEqual({
      keyIdBase64: CANNED_KEY_ID,
      contractId: CANNED_CONTRACT_ID,
      signedTx: "mock-signed-deployment-tx",
    });
  });

  it("connectWallet returns the same canned keyId and contractId", async () => {
    const kit = createMockPasskeyKit();
    await expect(kit.connectWallet()).resolves.toEqual({
      keyIdBase64: CANNED_KEY_ID,
      contractId: CANNED_CONTRACT_ID,
    });
  });

  it("sign returns the input transaction unchanged", async () => {
    const kit = createMockPasskeyKit();
    const tx = { some: "transaction" };
    await expect(kit.sign(tx)).resolves.toBe(tx);
  });
});
