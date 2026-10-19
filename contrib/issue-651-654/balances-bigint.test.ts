import { describe, expect, it, vi } from "vitest";
import {
  createBalanceService,
  fetchBalancesBatch,
  formatTokenAmount,
  type BalanceReader,
} from "../../src/balances";
import { parseTokenAmount } from "../../src/payments";

// Amount values are bigint end to end (#654). Audit of src/balances.ts and the
// helpers it feeds (payments.ts parseTokenAmount): no Number() conversion is
// applied to a balance or amount. These tests pin that with a value above
// Number.MAX_SAFE_INTEGER, which any Number round-trip would corrupt.

const BIG = BigInt(Number.MAX_SAFE_INTEGER) * 1000n + 7n; // 9007199254740991007
const token = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };

describe("bigint precision above Number.MAX_SAFE_INTEGER", () => {
  it("fixture is not representable as a Number", () => {
    expect(BigInt(Number(BIG))).not.toBe(BIG);
  });

  it("getBalances returns the reader amount unchanged", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi.fn().mockResolvedValue(BIG),
    };
    const [balance] = await createBalanceService(reader, [token]).getBalances("CHOLDER");
    expect(balance?.amount).toBe(BIG);
    expect(typeof balance?.amount).toBe("bigint");
  });

  it("getBalancesBatch returns the reader amount unchanged", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi.fn().mockResolvedValue(BIG),
    };
    await expect(
      createBalanceService(reader, [token]).getBalancesBatch("CHOLDER", [token]),
    ).resolves.toEqual([{ contractId: "CNATIVE", success: true, amount: BIG }]);
    await expect(fetchBalancesBatch(reader, "CHOLDER", [token])).resolves.toEqual([
      { contractId: "CNATIVE", success: true, amount: BIG },
    ]);
  });

  it("formatTokenAmount renders every digit", () => {
    expect(formatTokenAmount(BIG, 7)).toBe("900719925474.0991007");
    expect(formatTokenAmount(-BIG, 7)).toBe("-900719925474.0991007");
    expect(formatTokenAmount(BIG, 0)).toBe("9007199254740991007");
  });

  it("formatTokenAmount and parseTokenAmount round-trip exactly", () => {
    expect(parseTokenAmount(formatTokenAmount(BIG, 7), 7)).toBe(BIG);
    expect(parseTokenAmount(formatTokenAmount(BIG, 0), 0)).toBe(BIG);
  });

  it("a failing reader is reported per item without corrupting other amounts", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi.fn(async (id: string) => {
        if (id === "CBAD") throw new Error("rpc down");
        return BIG;
      }),
    };
    await expect(
      fetchBalancesBatch(reader, "CHOLDER", [{ contractId: "CNATIVE" }, { contractId: "CBAD" }]),
    ).resolves.toEqual([
      { contractId: "CNATIVE", success: true, amount: BIG },
      { contractId: "CBAD", success: false, error: "rpc down" },
    ]);
  });
});
