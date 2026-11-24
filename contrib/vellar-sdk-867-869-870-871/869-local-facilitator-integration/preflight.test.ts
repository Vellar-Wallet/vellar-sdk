import { describe, expect, it, vi } from "vitest";
import { isLocalUrl, probeFacilitator, readLocalFacilitatorEnv } from "./preflight.js";

const FULL_ENV = {
  VELLAR_LOCAL_FACILITATOR_URL: "http://127.0.0.1:4100",
  VELLAR_X402_SELLER_URL: "http://127.0.0.1:4021/paid",
  VELLAR_X402_RPC_URL: "https://soroban-testnet.stellar.org",
  VELLAR_X402_SECRET: "SLOCALONLY",
  VELLAR_X402_TEST_ASSET: "CLOCALONLY",
};

describe("local facilitator preflight (#869)", () => {
  it("skips cleanly when no integration variables are set", () => {
    expect(readLocalFacilitatorEnv({})).toBeNull();
  });

  it("parses a complete environment", () => {
    expect(readLocalFacilitatorEnv(FULL_ENV)).toEqual({
      facilitatorUrl: "http://127.0.0.1:4100",
      sellerUrl: "http://127.0.0.1:4021/paid",
      rpcUrl: "https://soroban-testnet.stellar.org",
      secret: "SLOCALONLY",
      asset: "CLOCALONLY",
    });
  });

  it("throws a clear error for a partial environment", () => {
    expect(() =>
      readLocalFacilitatorEnv({ VELLAR_LOCAL_FACILITATOR_URL: "http://127.0.0.1:4100" }),
    ).toThrow(/partially set.*Missing:.*VELLAR_X402_SELLER_URL/s);
  });

  it("refuses a hosted facilitator or seller URL", () => {
    expect(() =>
      readLocalFacilitatorEnv({
        ...FULL_ENV,
        VELLAR_LOCAL_FACILITATOR_URL: "https://facilitator.example.com",
      }),
    ).toThrow(/not localhost/);
    expect(() =>
      readLocalFacilitatorEnv({ ...FULL_ENV, VELLAR_X402_SELLER_URL: "http://example.com/paid" }),
    ).toThrow(/not localhost/);
  });

  it("accepts loopback spellings and rejects lookalike hosts", () => {
    expect(isLocalUrl("http://localhost:4100")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:4100")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1.evil.example")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
  });

  it("returns null when the facilitator answers, even with a non-2xx status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));

    expect(await probeFacilitator("http://127.0.0.1:4100", fetchImpl)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns a clear skip reason when the facilitator is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const reason = await probeFacilitator("http://127.0.0.1:4100", fetchImpl);
    expect(reason).toContain("not reachable");
    expect(reason).toContain("ECONNREFUSED");
    expect(reason).toContain("operators/limits.md");
  });

  it("uses a short timeout on the probe", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok"));
    await probeFacilitator("http://127.0.0.1:4100", fetchImpl, 1234);

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.method).toBe("GET");
  });
});
