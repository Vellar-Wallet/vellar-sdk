// Tests for resume-kit-verification.ts (#436)
import { describe, it, expect, vi } from "vitest";
import {
  PasskeyRevokedError,
  SignerVerificationFailedError,
  verifyKeyStillSigner,
  resumeKitConnectionWithVerification,
  type RpcClient,
} from "./resume-kit-verification.js";

describe("resume-kit-verification (#436)", () => {
  function mockRpcClient(signers: Array<{ keyId: string }> | Error): RpcClient {
    return {
      async getSigners() {
        if (signers instanceof Error) throw signers;
        return signers;
      },
    };
  }

  function mockKit() {
    return {
      wallet: undefined as unknown | undefined,
      connectWallet: vi.fn(async () => {
        // Simulate successful connection
      }),
    };
  }

  describe("verifyKeyStillSigner", () => {
    it("returns true when keyId is in signers list", async () => {
      const rpc = mockRpcClient([{ keyId: "key123" }, { keyId: "key456" }]);

      const result = await verifyKeyStillSigner("CWALLET...", "key123", { rpc });

      expect(result).toBe(true);
    });

    it("returns false when keyId is not in signers list", async () => {
      const rpc = mockRpcClient([{ keyId: "other-key" }]);

      const result = await verifyKeyStillSigner("CWALLET...", "key123", { rpc });

      expect(result).toBe(false);
    });

    it("throws SignerVerificationFailedError on RPC failure", async () => {
      const rpc = mockRpcClient(new Error("Network timeout"));

      await expect(
        verifyKeyStillSigner("CWALLET...", "key123", { rpc }),
      ).rejects.toThrow(SignerVerificationFailedError);

      await expect(
        verifyKeyStillSigner("CWALLET...", "key123", { rpc }),
      ).rejects.toThrow(/Could not verify signer status/);
    });

    it("bypasses verification when skipVerification is true", async () => {
      const rpc = mockRpcClient(new Error("Should not be called"));

      const result = await verifyKeyStillSigner("CWALLET...", "key123", {
        rpc,
        skipVerification: true,
      });

      expect(result).toBe(true);
    });
  });

  describe("resumeKitConnectionWithVerification", () => {
    it("connects successfully when key is valid", async () => {
      const kit = mockKit();
      const rpc = mockRpcClient([{ keyId: "key123" }]);

      await resumeKitConnectionWithVerification(kit, "key123", "CWALLET...", { rpc });

      expect(kit.connectWallet).toHaveBeenCalledWith({ keyId: "key123" });
      expect(kit.connectWallet).toHaveBeenCalledTimes(1);
    });

    it("throws PasskeyRevokedError when key is not a signer", async () => {
      const kit = mockKit();
      const rpc = mockRpcClient([{ keyId: "other-key" }]);

      await expect(
        resumeKitConnectionWithVerification(kit, "key123", "CWALLET123", { rpc }),
      ).rejects.toThrow(PasskeyRevokedError);

      await expect(
        resumeKitConnectionWithVerification(kit, "key123", "CWALLET123", { rpc }),
      ).rejects.toThrow(/no longer a signer/);

      // Kit was NOT connected
      expect(kit.connectWallet).not.toHaveBeenCalled();
    });

    it("throws SignerVerificationFailedError on network failure", async () => {
      const kit = mockKit();
      const rpc = mockRpcClient(new Error("RPC unreachable"));

      await expect(
        resumeKitConnectionWithVerification(kit, "key123", "CWALLET...", { rpc }),
      ).rejects.toThrow(SignerVerificationFailedError);

      // Distinguishable from revocation
      await expect(
        resumeKitConnectionWithVerification(kit, "key123", "CWALLET...", { rpc }),
      ).rejects.toThrow(/Could not verify signer status/);

      expect(kit.connectWallet).not.toHaveBeenCalled();
    });

    it("skips verification when kit is already connected", async () => {
      const kit = mockKit();
      kit.wallet = {}; // Already connected

      const rpc = mockRpcClient(new Error("Should not be called"));

      await resumeKitConnectionWithVerification(kit, "key123", "CWALLET...", { rpc });

      // No RPC call, no connectWallet call
      expect(kit.connectWallet).not.toHaveBeenCalled();
    });

    it("error types are distinguishable for different handling", async () => {
      const kit = mockKit();
      const rpcRevoked = mockRpcClient([{ keyId: "other" }]);
      const rpcFailed = mockRpcClient(new Error("Network error"));

      // Revoked key
      try {
        await resumeKitConnectionWithVerification(kit, "key123", "CWALLET...", {
          rpc: rpcRevoked,
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(PasskeyRevokedError);
        expect((err as PasskeyRevokedError).walletAddress).toBe("CWALLET...");
        expect((err as PasskeyRevokedError).keyId).toBe("key123");
      }

      // Network failure
      try {
        await resumeKitConnectionWithVerification(kit, "key123", "CWALLET...", {
          rpc: rpcFailed,
        });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(SignerVerificationFailedError);
        expect((err as SignerVerificationFailedError).walletAddress).toBe("CWALLET...");
      }
    });
  });
});
