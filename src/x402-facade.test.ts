import { describe, expect, it, vi } from "vitest";
import { createX402Facade } from "./x402-facade";
import { X402NotConfiguredError, type SmartAccountX402Signer } from "./x402-types";

const C_ADDRESS = "CC5ZSTLTYKPNIFDSJ4233RVZPALGHHDBRTXGIN6Z3AJCWU57VR5ITXXR";

const signer: SmartAccountX402Signer = {
  address: C_ADDRESS,
  async signAuthEntry() {
    return "";
  },
};

describe("createX402Facade", () => {
  it("throws X402NotConfiguredError when x402 config is absent", async () => {
    const facade = createX402Facade({ resolveSigner: () => signer });
    await expect(facade.fetch("https://res.test", { maxAmount: 1n })).rejects.toBeInstanceOf(
      X402NotConfiguredError,
    );
    await expect(
      facade.createPayment(
        {
          scheme: "exact",
          network: "stellar:testnet",
          asset: "C",
          amount: "1",
          payTo: "G",
        },
        { maxAmount: 1n },
      ),
    ).rejects.toBeInstanceOf(X402NotConfiguredError);
  });

  it("builds a client when configured (resolveSigner is consulted per call)", async () => {
    const resolveSigner = vi.fn(() => signer);
    const facade = createX402Facade({
      config: {
        rpcUrl: "https://soroban-testnet.stellar.org",
        network: "testnet",
        simulationSourceAccount: "GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA",
        fetchImpl: async () => new Response("ok", { status: 200 }),
      },
      resolveSigner,
    });
    // A no-payment-needed fetch resolves the signer lazily and returns passthrough.
    const out = await facade.fetch("https://res.test", { maxAmount: 1n });
    expect(out.paid).toBe(false);
    expect(resolveSigner).toHaveBeenCalled();
  });
});
