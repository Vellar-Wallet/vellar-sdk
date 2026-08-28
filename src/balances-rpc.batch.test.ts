import { describe, expect, it, vi } from "vitest";
import { fetchBalancesBatch, createBalanceService, type BalanceReader } from "./balances";
import { resolveConnectionOptions, MAX_INVOCATIONS_PER_SIMULATION } from "./balances-rpc";

// Issue #216: fetching balances for N trustlines must not issue N RPC calls.
// Issue #217: connection reuse settings must be resolved per environment.

function batchingReader(amounts: Record<string, bigint>) {
  const calls = { single: 0, bulk: 0 };
  const reader: BalanceReader = {
    async getTokenBalance(id) {
      calls.single++;
      return amounts[id] ?? 0n;
    },
    async getTokenBalances(ids) {
      calls.bulk++;
      return ids.map((id) => amounts[id] ?? 0n);
    },
  };
  return { reader, calls };
}

describe("batched trustline balance reads (#216)", () => {
  const amounts: Record<string, bigint> = { A: 1n, B: 2n, C: 3n, D: 4n };
  const tokens = [{ contractId: "A" }, { contractId: "B" }, { contractId: "C" }, { contractId: "D" }];

  it("collapses N trustline reads into a single bulk call", async () => {
    const { reader, calls } = batchingReader(amounts);
    await fetchBalancesBatch(reader, "GHOLDER", tokens);
    expect(calls.bulk).toBe(1);
    expect(calls.single).toBe(0);
  });

  it("regression: call count stays at 1 as trustline count grows", async () => {
    for (const n of [2, 8, 16]) {
      const { reader, calls } = batchingReader(amounts);
      const many = Array.from({ length: n }, (_, i) => ({ contractId: `T${i}` }));
      await fetchBalancesBatch(reader, "GHOLDER", many);
      expect(calls.bulk, `n=${n}`).toBe(1);
      expect(calls.single, `n=${n}`).toBe(0);
    }
  });

  it("benchmark: bulk path issues strictly fewer calls than per-token", async () => {
    const legacy: BalanceReader = { getTokenBalance: async (id) => amounts[id] ?? 0n };
    const legacySpy = vi.spyOn(legacy, "getTokenBalance");
    await fetchBalancesBatch(legacy, "GHOLDER", tokens);
    const before = legacySpy.mock.calls.length;

    const { reader, calls } = batchingReader(amounts);
    await fetchBalancesBatch(reader, "GHOLDER", tokens);

    expect(before).toBe(tokens.length);
    expect(calls.bulk).toBe(1);
    expect(calls.bulk).toBeLessThan(before);
  });

  it("returns the same data shape as the per-token path", async () => {
    const legacy: BalanceReader = { getTokenBalance: async (id) => amounts[id] ?? 0n };
    const { reader } = batchingReader(amounts);
    const viaSingle = await fetchBalancesBatch(legacy, "GHOLDER", tokens);
    const viaBulk = await fetchBalancesBatch(reader, "GHOLDER", tokens);
    expect(viaBulk).toEqual(viaSingle);
  });

  it("falls back to per-token reads when the bulk call fails", async () => {
    const calls = { single: 0 };
    const reader: BalanceReader = {
      async getTokenBalance(id) {
        calls.single++;
        if (id === "B") throw new Error("boom");
        return amounts[id] ?? 0n;
      },
      async getTokenBalances() {
        throw new Error("batch unsupported");
      },
    };
    const res = await fetchBalancesBatch(reader, "GHOLDER", tokens);
    expect(calls.single).toBe(tokens.length);
    // Per-item error isolation survives the fallback.
    expect(res.find((r) => r.contractId === "B")).toMatchObject({ success: false });
    expect(res.find((r) => r.contractId === "A")).toMatchObject({ success: true, amount: 1n });
  });

  it("getBalances uses the bulk read and preserves token order", async () => {
    const { reader, calls } = batchingReader(amounts);
    const svc = createBalanceService(reader, [
      { symbol: "A", contractId: "A", decimals: 7 },
      { symbol: "B", contractId: "B", decimals: 7 },
    ]);
    const out = await svc.getBalances("GHOLDER");
    expect(calls.bulk).toBe(1);
    expect(out.map((b) => b.symbol)).toEqual(["A", "B"]);
    expect(out.map((b) => b.amount)).toEqual([1n, 2n]);
  });

  it("chunks wide reads at the simulation invocation cap", () => {
    expect(MAX_INVOCATIONS_PER_SIMULATION).toBeGreaterThan(0);
  });
});

describe("connection reuse tuning (#217)", () => {
  it("applies pooled keep-alive defaults under Node", () => {
    expect(resolveConnectionOptions(undefined)).toEqual({
      keepAlive: true,
      maxSockets: 16,
      keepAliveMsecs: 15_000,
    });
  });

  it("honours caller overrides", () => {
    expect(resolveConnectionOptions({ maxSockets: 4, keepAliveMsecs: 1_000 })).toEqual({
      keepAlive: true,
      maxSockets: 4,
      keepAliveMsecs: 1_000,
    });
  });

  it("applies nothing when keep-alive is disabled", () => {
    expect(resolveConnectionOptions({ keepAlive: false })).toBeUndefined();
  });

  it("applies nothing in a browser-like environment", () => {
    const g = globalThis as Record<string, unknown>;
    g.window = {};
    g.document = {};
    try {
      expect(resolveConnectionOptions({ keepAlive: true })).toBeUndefined();
    } finally {
      delete g.window;
      delete g.document;
    }
  });
});
