import { describe, expect, it, vi } from "vitest";
import { createX402ClientWithFallback } from "./x402-client-fallback";
import { C_ADDRESS, SIM_SOURCE, requirements, response402 } from "../src/x402-test-fixtures";
import type { SmartAccountX402Signer } from "../src/index";

const stubSigner: SmartAccountX402Signer = {
  address: C_ADDRESS,
  async signAuthEntry() {
    throw new Error("signer should not have been called");
  },
};

function client(fetchImpl: any) {
  return createX402ClientWithFallback({
    signer: stubSigner,
    rpcUrl: "https://soroban-testnet.stellar.org",
    network: "testnet",
    simulationSourceAccount: SIM_SOURCE,
    fetchImpl,
  });
}

describe("x402 fetch fallback and timeout", () => {
  it("returns default fallback response when the discovery call times out", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (init?.signal) {
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(new DOMException("The user aborted a request.", "AbortError"));
          if (init.signal.aborted) {
            onAbort();
          } else {
            init.signal.addEventListener("abort", onAbort);
          }
        });
      }
      return new Response("ok", { status: 200 });
    });

    const c = client(fetchImpl);
    const out = await c.fetch("https://res.test/paid", {
      maxAmount: 10n,
      timeoutMs: 10,
    });

    expect(out.paid).toBe(false);
    expect(out.isFallback).toBe(true);
    expect(out.response.status).toBe(504);
    const body = await out.response.json();
    expect(body.partial).toBe(true);
  });

  it("returns custom fallback response when the discovery call times out", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (init?.signal) {
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(new DOMException("The user aborted a request.", "AbortError"));
          if (init.signal.aborted) {
            onAbort();
          } else {
            init.signal.addEventListener("abort", onAbort);
          }
        });
      }
      return new Response("ok", { status: 200 });
    });

    const customRes = new Response("custom fallback data", { status: 200 });
    const c = client(fetchImpl);
    const out = await c.fetch("https://res.test/paid", {
      maxAmount: 10n,
      timeoutMs: 10,
      fallbackResponse: customRes,
    });

    expect(out.paid).toBe(false);
    expect(out.isFallback).toBe(true);
    expect(out.response).toBe(customRes);
    const text = await out.response.text();
    expect(text).toBe("custom fallback data");
  });
});
