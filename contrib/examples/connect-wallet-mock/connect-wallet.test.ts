import { describe, expect, it } from "vitest";
import { MockWalletBackend, connectWallet } from "./connect-wallet";

describe("connectWallet (mock backend)", () => {
  const backend = new MockWalletBackend({
    "keyid-known-abc123": { contractId: "CABC123" },
  });

  it("resolves a known keyId to its session", async () => {
    await expect(connectWallet(backend, "keyid-known-abc123")).resolves.toEqual({
      accountId: "CABC123",
      keyId: "keyid-known-abc123",
      connected: true,
    });
  });

  it("throws a clear error for an unknown keyId", async () => {
    await expect(connectWallet(backend, "nope")).rejects.toThrow(
      'no wallet is registered for keyId "nope"',
    );
  });
});
