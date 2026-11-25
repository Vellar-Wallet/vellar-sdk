import { describe, expect, it } from "vitest";
import { MainnetConfigError, mainnetConfig } from "./config";

const VALID_HASH = "a".repeat(64);
const RPC = "https://rpc.example.com";

/** Capture a MainnetConfigError without relying on message text. */
function failure(opts: { rpcUrl: string; walletWasmHash: string }): MainnetConfigError {
  try {
    mainnetConfig(opts);
  } catch (error) {
    expect(error).toBeInstanceOf(MainnetConfigError);
    return error as MainnetConfigError;
  }
  throw new Error("expected mainnetConfig to throw a MainnetConfigError");
}

describe("#863 — MainnetConfigError carries a distinct code per failure", () => {
  it("codes a missing rpcUrl as missing-rpcUrl", () => {
    const error = failure({ rpcUrl: "", walletWasmHash: VALID_HASH });
    expect(error.code).toBe("missing-rpcUrl");
  });

  it("codes a malformed rpcUrl as malformed-rpcUrl", () => {
    const error = failure({ rpcUrl: "not-a-url", walletWasmHash: VALID_HASH });
    expect(error.code).toBe("malformed-rpcUrl");
  });

  it("codes a missing walletWasmHash as missing-walletWasmHash", () => {
    const error = failure({ rpcUrl: RPC, walletWasmHash: "" });
    expect(error.code).toBe("missing-walletWasmHash");
  });

  it("codes a malformed walletWasmHash as malformed-walletWasmHash", () => {
    const error = failure({ rpcUrl: RPC, walletWasmHash: "abc" });
    expect(error.code).toBe("malformed-walletWasmHash");
  });

  it("uses four distinct codes for the four documented failure modes", () => {
    const codes = [
      failure({ rpcUrl: "", walletWasmHash: VALID_HASH }).code,
      failure({ rpcUrl: "not-a-url", walletWasmHash: VALID_HASH }).code,
      failure({ rpcUrl: RPC, walletWasmHash: "" }).code,
      failure({ rpcUrl: RPC, walletWasmHash: "abc" }).code,
    ];
    expect(new Set(codes).size).toBe(4);
  });

  it("keeps messages human-readable and leaves code unset for direct construction", () => {
    const error = failure({ rpcUrl: "", walletWasmHash: VALID_HASH });
    expect(error.message).toMatch(/rpcUrl is required/);
    expect(new MainnetConfigError("direct construction").code).toBeUndefined();
  });

  it("does not set a code on the happy path (no error is thrown)", () => {
    const config = mainnetConfig({ rpcUrl: RPC, walletWasmHash: VALID_HASH });
    expect(config.rpcUrl).toBe(RPC);
    expect(config.walletWasmHash).toBe(VALID_HASH);
  });
});

describe("#857 / #858 — mainnetConfig validates each required field independently", () => {
  it("names walletWasmHash when a valid rpcUrl is paired with a missing hash", () => {
    const error = failure({ rpcUrl: RPC, walletWasmHash: "" });

    expect(error.code).toBe("missing-walletWasmHash");
    expect(error.message).toContain("walletWasmHash");
  });

  it("names rpcUrl when a valid hash is paired with a missing RPC endpoint", () => {
    const error = failure({ rpcUrl: "", walletWasmHash: VALID_HASH });

    expect(error.code).toBe("missing-rpcUrl");
    expect(error.message).toContain("rpcUrl");
  });

  it("keeps malformed values distinct from omitted values", () => {
    expect(failure({ rpcUrl: "not-a-url", walletWasmHash: VALID_HASH }).code).toBe(
      "malformed-rpcUrl",
    );
    expect(failure({ rpcUrl: RPC, walletWasmHash: "not-a-hash" }).code).toBe(
      "malformed-walletWasmHash",
    );
  });
});
