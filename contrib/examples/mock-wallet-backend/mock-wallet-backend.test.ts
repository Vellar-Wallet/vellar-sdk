import { describe, expect, it } from "vitest";
import {
  CANNED_CONTRACT_ID,
  CANNED_SESSION_ID,
  CANNED_TX_HASH,
  createMockWalletBackend,
} from "./mock-wallet-backend";

describe("createMockWalletBackend", () => {
  it("submitWalletCreation returns the canned session id", async () => {
    const backend = createMockWalletBackend();
    await expect(
      backend.submitWalletCreation({
        keyId: "any",
        contractId: "any",
        network: "testnet",
        signedTx: "any",
      }),
    ).resolves.toEqual({ sessionId: CANNED_SESSION_ID });
  });

  it("lookupContractId returns the canned contract and session id", async () => {
    const backend = createMockWalletBackend();
    await expect(backend.lookupContractId({ keyId: "any", network: "testnet" })).resolves.toEqual({
      contractId: CANNED_CONTRACT_ID,
      sessionId: CANNED_SESSION_ID,
    });
  });

  it("submitTransaction returns the canned tx hash", async () => {
    const backend = createMockWalletBackend();
    await expect(
      backend.submitTransaction({ signedXdr: "any", network: "testnet" }),
    ).resolves.toEqual({ hash: CANNED_TX_HASH });
  });
});
