import { describe, expect, it } from "vitest";
import { createBalanceService } from "../../../src/balances";
import { createMockBalanceReader } from "./mock-sac-client";

describe("createMockBalanceReader", () => {
  it("returns the configured fixed balance for any account", async () => {
    const reader = createMockBalanceReader(1_000n);
    await expect(reader.getTokenBalance("CTOKEN", "GALICE")).resolves.toBe(1_000n);
    await expect(reader.getTokenBalance("CTOKEN", "GBOB")).resolves.toBe(1_000n);
  });

  it("returns the same fixed balance regardless of the token contract queried", async () => {
    const reader = createMockBalanceReader(42n);
    await expect(reader.getTokenBalance("CTOKEN_A", "GALICE")).resolves.toBe(42n);
    await expect(reader.getTokenBalance("CTOKEN_B", "GALICE")).resolves.toBe(42n);
  });

  it("wires cleanly into the real createBalanceService", async () => {
    const reader = createMockBalanceReader(250n);
    const xlm = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };
    const service = createBalanceService(reader, [xlm]);

    await expect(service.getBalances("GALICE")).resolves.toEqual([{ ...xlm, amount: 250n }]);
  });
});
