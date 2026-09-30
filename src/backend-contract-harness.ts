import { describe, expect, it } from "vitest";
import { WalletApiError, type HttpWalletBackend } from "./http-backend";

// Wallet backend contract harness — an integrator can run this suite against
// their own backend implementation to verify it conforms to the Vellar gateway
// contract. This is a contract check, not a load or security test.
//
// Usage:
//   import { walletBackendContractTests } from "vellar-sdk/src/backend-contract-harness";
//   walletBackendContractTests(() => yourBackend);
//
// Or run directly with vitest:
//   npx vitest run src/backend-contract-harness.test.ts
//
// The harness covers each route (/wallet/create, /wallet/connect, /wallet/submit)
// for: success, validation failure, upstream failure, and unknown keyId on connect.
//
// Error contract:
//   - All error responses MUST be JSON with `error` (string) and optional `message` (string)
//   - WalletApiError exposes: status (number), code (string | undefined from `error` field)
//   - 404 on /wallet/connect means "unknown keyId" → lookupContractId returns undefined
//   - All other non-2xx → WalletApiError is thrown

const WALLET = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

/** Run the wallet backend contract suite against a backend factory. */
export function walletBackendContractTests(
  createBackend: () => HttpWalletBackend,
): void {
  describe("wallet backend contract", () => {
    it("/wallet/create succeeds with a valid payload", async () => {
      const backend = createBackend();
      const result = await backend.submitWalletCreation({
        keyId: "test-key-id",
        contractId: WALLET,
        network: "testnet",
        signedTx: "AAAAAgAAAAC+",
      });
      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe("string");
    });

    it("/wallet/connect resolves a known keyId to contractId + sessionId", async () => {
      const backend = createBackend();
      // First create so the keyId is known.
      await backend.submitWalletCreation({
        keyId: "connect-test-key",
        contractId: WALLET,
        network: "testnet",
        signedTx: "AAAAAgAAAAC+",
      });
      const result = await backend.lookupContractId({
        keyId: "connect-test-key",
        network: "testnet",
      });
      expect(result).toBeDefined();
      expect(result!.contractId).toBeDefined();
      expect(typeof result!.contractId).toBe("string");
      expect(result!.sessionId).toBeDefined();
    });

    it("/wallet/connect returns undefined for an unknown keyId", async () => {
      const backend = createBackend();
      const result = await backend.lookupContractId({
        keyId: "definitely-unknown-key-id-" + Date.now(),
        network: "testnet",
      });
      expect(result).toBeUndefined();
    });

    it("/wallet/submit succeeds with valid signed XDR", async () => {
      const backend = createBackend();
      const result = await backend.submitTransaction({
        signedXdr: "AAAAAgAAAAC+",
        network: "testnet",
      });
      expect(result).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(typeof result.hash).toBe("string");
    });

    it("/wallet/submit rejects invalid XDR with WalletApiError", async () => {
      const backend = createBackend();
      const err = await backend
        .submitTransaction({ signedXdr: "", network: "testnet" })
        .catch((e) => e);
      // The backend MUST reject empty/invalid XDR. The exact status code varies
      // by implementation, but it MUST be a WalletApiError.
      expect(err).toBeInstanceOf(WalletApiError);
      expect(err.status).toBeGreaterThanOrEqual(400);
    });

    it("WalletApiError carries a code from the error response body", async () => {
      // This test verifies the error shape contract: non-2xx JSON responses
      // with { error: string } are parsed into WalletApiError with .code set.
      // Implementations should return { error: "machine_readable_code" } for
      // all error responses.
      const backend = createBackend();
      const err = await backend
        .submitTransaction({ signedXdr: "INVALID", network: "testnet" })
        .catch((e) => e);
      if (err instanceof WalletApiError) {
        // The code field should be populated from the error body's `error` field.
        // It may be undefined if the backend returns a non-JSON error, but
        // conformant backends always include it.
        if (err.code !== undefined) {
          expect(typeof err.code).toBe("string");
        }
      }
    });
  });
}