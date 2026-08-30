import { describe, expect, it } from "vitest";
import {
  formatClientError,
  requirePoliciesApiUrl,
  requireSession,
  VellarClientError,
  WalletNotReadyError,
} from "./client-error-shape";

describe("VellarClientError shape", () => {
  it("pay() guard exposes code, message, and details", () => {
    try {
      requireSession(null, "pay");
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(VellarClientError);
      const error = err as VellarClientError;
      expect(error.code).toBe("WALLET_NOT_READY");
      expect(error.message).toMatch(/create\(\) or connect\(\)/);
      expect(error.details).toEqual({ method: "pay" });
      expect(formatClientError(error)).toBe(
        '[WALLET_NOT_READY] Call create() or connect() before pay() — {"method":"pay"}',
      );
    }
  });

  it("policies without apiUrl exposes POLICIES_NOT_CONFIGURED", () => {
    try {
      requirePoliciesApiUrl(undefined);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(VellarClientError);
      expect((err as VellarClientError).code).toBe("POLICIES_NOT_CONFIGURED");
      expect((err as VellarClientError).details).toEqual({ missing: "apiUrl" });
    }
  });

  it("agents guard includes method details", () => {
    try {
      requireSession(null, "agents");
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WalletNotReadyError);
      expect((err as VellarClientError).code).toBe("WALLET_NOT_READY");
      expect((err as VellarClientError).details).toEqual({ method: "agents" });
    }
  });
});
