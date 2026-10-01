import { describe, expect, it, vi } from "vitest";
import { assertFacilitatorNetwork, preflightThenSign, type SupportedFetch } from "./preflight";

const FACILITATOR_URL = "https://facilitator.example";

function supported(networks: unknown[] = ["stellar:testnet"]) {
  return { ok: true, status: 200, json: async () => ({ networks }) };
}

describe("facilitator /supported network preflight (#512)", () => {
  it("names configured and advertised networks and refuses before signing", async () => {
    const fetchImpl = vi.fn(async () => supported(["stellar:pubnet"]));
    const sign = vi.fn(async () => "signed-payload");

    await expect(
      preflightThenSign(
        fetchImpl as SupportedFetch,
        FACILITATOR_URL,
        "testnet",
        "stellar:testnet",
        sign,
      ),
    ).rejects.toThrow(
      /configured network "testnet" \(stellar:testnet\).*stellar:pubnet.*Nothing was signed/,
    );

    expect(fetchImpl).toHaveBeenCalledWith("https://facilitator.example/supported");
    expect(sign).not.toHaveBeenCalled();
  });

  it("signs only after the facilitator advertises the configured network", async () => {
    const fetchImpl = vi.fn(async () => supported(["stellar:testnet", "stellar:pubnet"]));
    const sign = vi.fn(async () => "signed-payload");

    await expect(
      preflightThenSign(
        fetchImpl as SupportedFetch,
        FACILITATOR_URL,
        "testnet",
        "stellar:testnet",
        sign,
      ),
    ).resolves.toBe("signed-payload");
    expect(sign).toHaveBeenCalledOnce();
  });

  it("rejects malformed /supported networks data", async () => {
    const fetchImpl = vi.fn(async () => supported(["stellar:testnet", 42]));
    await expect(
      assertFacilitatorNetwork(
        fetchImpl as SupportedFetch,
        FACILITATOR_URL,
        "testnet",
        "stellar:testnet",
      ),
    ).rejects.toThrow("invalid networks list");
  });
});