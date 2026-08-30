import { describe, expect, it, vi } from "vitest";
import type { BalanceReader } from "../../../src/balances";
import { readTokenBalance } from "./read-token-balance";

describe("readTokenBalance", () => {
  it("returns the raw base-unit balance from the reader", async () => {
    const reader: BalanceReader = { getTokenBalance: vi.fn().mockResolvedValue(42_500_000n) };
    await expect(readTokenBalance(reader, "CTOKEN", "GHOLDER")).resolves.toBe(42_500_000n);
    expect(reader.getTokenBalance).toHaveBeenCalledWith("CTOKEN", "GHOLDER");
  });

  it("propagates reader failures", async () => {
    const reader: BalanceReader = { getTokenBalance: vi.fn().mockRejectedValue(new Error("rpc down")) };
    await expect(readTokenBalance(reader, "CTOKEN", "GHOLDER")).rejects.toThrow("rpc down");
  });
});
