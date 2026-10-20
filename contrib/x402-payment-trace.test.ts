import { describe, expect, it, vi } from "vitest";
import { createX402Client, type FetchLike } from "../src/x402-client";
import { createX402Tracer, instrumentX402ClientDeps, type X402TraceStepName } from "./x402-payment-trace";
import { C_ADDRESS, SIM_SOURCE, response402, requirements } from "../src/x402-test-fixtures";
import { MaxAmountExceededError, type SmartAccountX402Signer } from "../src/x402-types";

const RAW_SIGNATURE = "RAW_SIGNING_MATERIAL_9f3c1a";
const SECRET_SEED = `S${"A".repeat(55)}`;

describe("x402 trace — simulated multi-step payment", () => {
  function simulated() {
    const tracer = createX402Tracer({ secrets: [SECRET_SEED, RAW_SIGNATURE] });
    tracer.record({
      step: "discovery",
      ok: true,
      request: { url: "https://seller.test/quote", method: "GET" },
      response: { status: 402 },
    });
    tracer.record({
      step: "quote",
      ok: true,
      request: { url: "https://seller.test/quote" },
      response: { asset: "CABC", amount: "1000000", payTo: "GDEST", scheme: "exact" },
    });
    tracer.record({
      step: "sign",
      ok: true,
      request: { address: C_ADDRESS, amount: "1000000", note: `payer ${SECRET_SEED}` },
      response: { signedEntry: RAW_SIGNATURE },
    });
    tracer.record({
      step: "submit",
      ok: true,
      request: {
        url: "https://seller.test/quote",
        headers: { "PAYMENT-SIGNATURE": RAW_SIGNATURE, "X-Vellar-Signature": RAW_SIGNATURE },
      },
      response: { status: 200 },
    });
    tracer.record({
      step: "settlement",
      ok: true,
      request: { url: "https://seller.test/quote" },
      response: { transaction: "abc123", payer: C_ADDRESS, amount: "1000000", network: "testnet" },
    });
    return tracer;
  }

  it("keeps raw signing material out of the trace before anything is written", () => {
    const body = JSON.stringify(simulated().snapshot());
    expect(body).not.toContain(RAW_SIGNATURE);
    expect(body).not.toContain(SECRET_SEED);
    const steps = simulated().snapshot().steps.map((s) => s.step);
    expect(steps).toEqual(["discovery", "quote", "sign", "submit", "settlement"] satisfies X402TraceStepName[]);
    expect(simulated().snapshot().steps[4]?.response).toMatchObject({ transaction: "abc123" });
  });

  it("hands the writer an already-redacted document, including when the write crashes", () => {
    const writes: string[] = [];
    expect(() =>
      simulated().exportToFile("x402-trace.json", (file, data) => {
        expect(file).toBe("x402-trace.json");
        writes.push(data);
        throw new Error("crash mid-write");
      }),
    ).toThrow(/crash mid-write/);

    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain(RAW_SIGNATURE);
    expect(writes[0]).not.toContain(SECRET_SEED);
    const parsed = JSON.parse(writes[0]!) as { version: number; steps: { step: string }[] };
    expect(parsed.version).toBe(1);
    expect(parsed.steps).toHaveLength(5);
  });

  it("writes a single document and does not call the writer twice", () => {
    const write = vi.fn();
    simulated().exportToFile("x402-trace.json", write);
    expect(write).toHaveBeenCalledTimes(1);
    const body = String(write.mock.calls[0]?.[1]);
    expect(body).toContain('"[redacted]"');
    expect(body).not.toContain(RAW_SIGNATURE);
  });
});

describe("x402 trace — wired into the payment client", () => {
  const signer: SmartAccountX402Signer = {
    address: C_ADDRESS,
    async signAuthEntry() {
      throw new Error(`signer leaked ${RAW_SIGNATURE}`);
    },
  };

  function client(fetchImpl: FetchLike, trace = createX402Tracer({ secrets: [RAW_SIGNATURE] })) {
    return {
      trace,
      x402: createX402Client(
        instrumentX402ClientDeps(
          {
            signer,
            rpcUrl: "https://soroban-testnet.stellar.org",
            network: "testnet" as const,
            simulationSourceAccount: SIM_SOURCE,
            fetchImpl,
          },
          trace,
        ),
      ),
    };
  }

  it("records discovery and the quote without calling the signer", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements({ amount: "5000000" })]));
    const { trace, x402 } = client(fetchImpl);
    await expect(x402.fetch("https://res.test/paid", { maxAmount: 1n })).rejects.toBeInstanceOf(
      MaxAmountExceededError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const steps = trace.snapshot().steps;
    expect(steps.map((s) => s.step)).toEqual(["discovery", "quote"]);
    expect(JSON.stringify(steps)).not.toContain(RAW_SIGNATURE);
  });

  it("records only discovery when the resource does not require payment", async () => {
    const { trace, x402 } = client(vi.fn(async () => new Response("ok", { status: 200 })));
    const out = await x402.fetch("https://res.test/free", { maxAmount: 1n });
    expect(out.paid).toBe(false);
    expect(trace.snapshot().steps.map((s) => s.step)).toEqual(["discovery"]);
  });

  it("records nothing when trace mode is off", async () => {
    const x402 = createX402Client({
      signer,
      rpcUrl: "https://soroban-testnet.stellar.org",
      network: "testnet",
      simulationSourceAccount: SIM_SOURCE,
      fetchImpl: vi.fn(async () => new Response("ok", { status: 200 })),
    });
    await expect(x402.fetch("https://res.test/free", { maxAmount: 1n })).resolves.toMatchObject({
      paid: false,
    });
  });
});
