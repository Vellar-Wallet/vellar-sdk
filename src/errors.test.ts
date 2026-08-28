import { describe, it, expect } from "vitest";
import { VellarError, VellarErrorCode } from "./errors";

describe("Issue #249 — Standardized Error Codes", () => {
  it("enforces standardized naming format VELLAR_<MODULE>_<REASON>", () => {
    const regex = /^VELLAR_[A-Z0-9]+_[A-Z0-9_]+$/;
    for (const code of Object.values(VellarErrorCode)) {
      expect(code).toMatch(regex);
    }
  });

  it("constructs VellarError with code, message, and details", () => {
    const err = new VellarError(
      VellarErrorCode.RPC_RATE_LIMIT_EXCEEDED,
      "Too many requests sent to Soroban RPC",
      { retryAfterMs: 5000 }
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(VellarError);
    expect(err.code).toBe("VELLAR_RPC_RATE_LIMIT_EXCEEDED");
    expect(err.message).toContain("[VELLAR_RPC_RATE_LIMIT_EXCEEDED]");
    expect(err.details?.retryAfterMs).toBe(5000);
  });
});
