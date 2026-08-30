import { describe, expect, it, vi } from "vitest";
import {
  buildBalanceInvocations,
  chunk,
  createBatchedBalanceService,
  createUnbatchedBalanceService,
  MAX_INVOCATIONS_PER_SIMULATION,
  type BalanceReader,
  type BatchBalanceReader,
} from "./batched-trustline-balances";

const HOLDER = "CHOLDER";

/** Deterministic balance so batched and unbatched results are comparable. */
function amountFor(contractId: string): bigint {
  return BigInt(contractId.length * 100);
}

function stubSingleReader(failing: string[] = []): BalanceReader {
  return {
    getTokenBalance: vi.fn(async (contractId: string) => {
      if (failing.includes(contractId)) throw new Error(`unknown asset ${contractId}`);
      return amountFor(contractId);
    }),
  };
}

function stubBatchReader(failing: string[] = []): BatchBalanceReader {
  return {
    getTokenBalances: vi.fn(async (ids: string[]) => {
      // A batched simulation fails as a unit: one bad id kills the whole call.
      const bad = ids.find((id) => failing.includes(id));
      if (bad) throw new Error(`simulation failed: unknown asset ${bad}`);
      return ids.map(amountFor);
    }),
  };
}

function trustlines(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `CTOKEN${"X".repeat(i)}`);
}

describe("createBatchedBalanceService", () => {
  it("reads many trustlines in a single RPC call", async () => {
    const batchReader = stubBatchReader();
    const service = createBatchedBalanceService(batchReader, stubSingleReader());

    const tokens = trustlines(8);
    const results = await service.getBalances(HOLDER, tokens);

    expect(results).toHaveLength(8);
    expect(service.rpcCalls).toBe(1);
    expect(batchReader.getTokenBalances).toHaveBeenCalledTimes(1);
    expect(batchReader.getTokenBalances).toHaveBeenCalledWith(tokens, HOLDER);
  });

  it("returns results in request order", async () => {
    const service = createBatchedBalanceService(stubBatchReader(), stubSingleReader());
    const tokens = trustlines(5);

    const results = await service.getBalances(HOLDER, tokens);

    expect(results.map((r) => r.contractId)).toEqual(tokens);
  });

  it("issues no call for an empty token list", async () => {
    const batchReader = stubBatchReader();
    const service = createBatchedBalanceService(batchReader, stubSingleReader());

    await expect(service.getBalances(HOLDER, [])).resolves.toEqual([]);
    expect(service.rpcCalls).toBe(0);
    expect(batchReader.getTokenBalances).not.toHaveBeenCalled();
  });

  it("chunks past the per-simulation invocation cap", async () => {
    const batchReader = stubBatchReader();
    const service = createBatchedBalanceService(batchReader, stubSingleReader(), {
      maxBatchSize: 5,
    });

    const results = await service.getBalances(HOLDER, trustlines(12));

    // 12 tokens / 5 per simulation = 3 calls, not 12.
    expect(service.rpcCalls).toBe(3);
    expect(results).toHaveLength(12);
    expect(results.map((r) => r.contractId)).toEqual(trustlines(12));
  });

  it("defaults the batch size to the documented invocation cap", async () => {
    const batchReader = stubBatchReader();
    const service = createBatchedBalanceService(batchReader, stubSingleReader());

    await service.getBalances(HOLDER, trustlines(MAX_INVOCATIONS_PER_SIMULATION + 1));

    expect(service.rpcCalls).toBe(2);
  });
});

describe("behaviour parity with the unbatched path", () => {
  it("returns the identical data shape and values", async () => {
    const tokens = trustlines(6);

    const batched = createBatchedBalanceService(stubBatchReader(), stubSingleReader());
    const unbatched = createUnbatchedBalanceService(stubSingleReader());

    const batchedResults = await batched.getBalances(HOLDER, tokens);
    const unbatchedResults = await unbatched.getBalances(HOLDER, tokens);

    expect(batchedResults).toEqual(unbatchedResults);
    // Amounts are still bigint, not a stringified or wrapped form.
    for (const result of batchedResults) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(typeof result.amount).toBe("bigint");
    }
  });

  it("preserves per-item error isolation by falling back when a batch fails", async () => {
    const tokens = ["CGOOD", "CBAD", "CALSOGOOD"];
    const batched = createBatchedBalanceService(
      stubBatchReader(["CBAD"]),
      stubSingleReader(["CBAD"]),
    );
    const unbatched = createUnbatchedBalanceService(stubSingleReader(["CBAD"]));

    const batchedResults = await batched.getBalances(HOLDER, tokens);
    const unbatchedResults = await unbatched.getBalances(HOLDER, tokens);

    // One bad token does not poison the good ones, same as before.
    expect(batchedResults).toEqual(unbatchedResults);
    expect(batchedResults[0]).toEqual({ contractId: "CGOOD", ok: true, amount: amountFor("CGOOD") });
    expect(batchedResults[1]).toEqual({
      contractId: "CBAD",
      ok: false,
      error: "unknown asset CBAD",
    });
  });

  it("counts the fallback calls separately so the slow path is visible", async () => {
    const batched = createBatchedBalanceService(
      stubBatchReader(["CBAD"]),
      stubSingleReader(["CBAD"]),
    );

    await batched.getBalances(HOLDER, ["CGOOD", "CBAD", "CALSOGOOD"]);

    // 1 failed batch + 3 per-token retries.
    expect(batched.rpcCalls).toBe(4);
    expect(batched.fallbackCalls).toBe(3);
  });

  it("surfaces the batch error without retrying when fallback is disabled", async () => {
    const singleReader = stubSingleReader(["CBAD"]);
    const batched = createBatchedBalanceService(stubBatchReader(["CBAD"]), singleReader, {
      fallbackToSingle: false,
    });

    const results = await batched.getBalances(HOLDER, ["CGOOD", "CBAD"]);

    expect(results.every((r) => !r.ok)).toBe(true);
    expect(batched.rpcCalls).toBe(1);
    expect(singleReader.getTokenBalance).not.toHaveBeenCalled();
  });
});

describe("benchmark: RPC call count before vs after", () => {
  const cases = [1, 4, 10, 25];

  it.each(cases)("collapses %i trustlines into far fewer calls", async (n) => {
    const tokens = trustlines(n);

    const before = createUnbatchedBalanceService(stubSingleReader());
    await before.getBalances(HOLDER, tokens);

    const after = createBatchedBalanceService(stubBatchReader(), stubSingleReader());
    await after.getBalances(HOLDER, tokens);

    // Before: strictly one call per trustline — the N+1 this issue reports.
    expect(before.rpcCalls).toBe(n);
    // After: one call per chunk of MAX_INVOCATIONS_PER_SIMULATION.
    expect(after.rpcCalls).toBe(Math.ceil(n / MAX_INVOCATIONS_PER_SIMULATION));
    expect(after.rpcCalls).toBeLessThanOrEqual(before.rpcCalls);
  });

  it("regression: 15 trustlines stay at exactly one RPC call", async () => {
    const after = createBatchedBalanceService(stubBatchReader(), stubSingleReader());

    await after.getBalances(HOLDER, trustlines(15));

    // Pin the count. Any reintroduced per-token read breaks this immediately.
    expect(after.rpcCalls).toBe(1);
    expect(after.fallbackCalls).toBe(0);
  });

  it("regression: a repeated read does not accumulate hidden calls", async () => {
    const after = createBatchedBalanceService(stubBatchReader(), stubSingleReader());
    const tokens = trustlines(10);

    await after.getBalances(HOLDER, tokens);
    await after.getBalances(HOLDER, tokens);

    expect(after.rpcCalls).toBe(2);
  });
});

describe("chunk", () => {
  it("splits into fixed-size groups, last one short", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns nothing for an empty list", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("rejects a zero or negative size", () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe("buildBalanceInvocations", () => {
  it("produces one balance(holder) invocation per token, in order", () => {
    expect(buildBalanceInvocations(["CA", "CB"], HOLDER)).toEqual([
      { contract: "CA", function: "balance", args: [HOLDER] },
      { contract: "CB", function: "balance", args: [HOLDER] },
    ]);
  });
});
