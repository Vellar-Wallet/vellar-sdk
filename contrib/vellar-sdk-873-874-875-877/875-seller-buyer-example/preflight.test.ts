import { describe, expect, it, vi } from "vitest";
import { isLocalUrl, probeFacilitator, readSellerBuyerEnv } from "./preflight.js";

const FULL_ENV = {
  VELLAR_LOCAL_FACILITATOR_URL: "http://127.0.0.1:4100",
  VELLAR_X402_RPC_URL: "https://soroban-testnet.stellar.org",
  VELLAR_X402_SECRET: "SLOCALONLY",
  VELLAR_X402_TEST_ASSET: "CLOCALONLY",
};

describe("seller and buyer example preflight (#875)", () => {
  it("skips cleanly when nothing is configured", () => {
    expect(readSellerBuyerEnv({})).toBeNull();
  });

  it("parses a complete environment", () => {
    expect(readSellerBuyerEnv(FULL_ENV)).toEqual({
      facilitatorUrl: "http://127.0.0.1:4100",
      rpcUrl: "https://soroban-testnet.stellar.org",
      secret: "SLOCALONLY",
      asset: "CLOCALONLY",
    });
  });

  it("names every missing variable on a partial configuration", () => {
    expect(() => readSellerBuyerEnv({ VELLAR_X402_SECRET: "SLOCALONLY" })).toThrow(
      /partially set.*Missing:.*VELLAR_LOCAL_FACILITATOR_URL/s,
    );
  });

  it("refuses a non-local facilitator", () => {
    expect(() =>
      readSellerBuyerEnv({ ...FULL_ENV, VELLAR_LOCAL_FACILITATOR_URL: "https://example.com" }),
    ).toThrow(/not localhost/);
    expect(isLocalUrl("http://127.0.0.1.evil.example")).toBe(false);
  });

  it("skips with a clear reason when the facilitator is down", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const reason = await probeFacilitator("http://127.0.0.1:4100", fetchImpl);

    expect(reason).toContain("not reachable");
    expect(reason).toContain("ECONNREFUSED");
  });

  it("treats any HTTP response as a live facilitator", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok", { status: 500 }));
    expect(await probeFacilitator("http://127.0.0.1:4100", fetchImpl)).toBeNull();
  });
});
