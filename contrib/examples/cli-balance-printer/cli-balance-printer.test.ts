import { describe, expect, it } from "vitest";
import {
  createMockBalanceReader,
  formatBalanceTable,
  parseArgs,
  printBalances,
  resolveTokens,
} from "./cli-balance-printer";
import type { BalanceReader } from "../../../src/balances";

const ACCOUNT = "CMOCKACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const USDC = "CUSDCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const XLM = "CXLMMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const EURC = "CEURCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

describe("parseArgs", () => {
  it("takes the account id first and every remaining argument as a token", () => {
    expect(parseArgs([ACCOUNT, USDC, XLM])).toEqual({
      accountId: ACCOUNT,
      tokenContractIds: [USDC, XLM],
    });
  });

  it("accepts a single token", () => {
    expect(parseArgs([ACCOUNT, USDC].map(String)).tokenContractIds).toEqual([USDC]);
  });

  it("collapses a repeated token contract id", () => {
    expect(parseArgs([ACCOUNT, USDC, XLM, USDC]).tokenContractIds).toEqual([USDC, XLM]);
  });

  it("throws when no arguments are given at all", () => {
    expect(() => parseArgs([])).toThrow(/Missing <accountId>/);
  });

  it("throws when the account id is given but no token is", () => {
    expect(() => parseArgs([ACCOUNT])).toThrow(/At least one <tokenContractId>/);
  });
});

describe("resolveTokens", () => {
  it("resolves known contract ids to their token info", () => {
    expect(resolveTokens([USDC, EURC])).toEqual([
      { symbol: "USDC", contractId: USDC, decimals: 7 },
      { symbol: "EURC", contractId: EURC, decimals: 6 },
    ]);
  });

  it("rejects an unknown contract id and lists the known ones", () => {
    expect(() => resolveTokens([USDC, "CNOTATOKEN"])).toThrow(/Unknown token contract "CNOTATOKEN"/);
    expect(() => resolveTokens(["CNOTATOKEN"])).toThrow(new RegExp(USDC));
  });
});

describe("createMockBalanceReader", () => {
  it("returns the seeded balance for a known holder", async () => {
    await expect(createMockBalanceReader().getTokenBalance(USDC, ACCOUNT)).resolves.toBe(
      1_250_5000000n,
    );
  });

  it("reads zero for a holder that has never held the token", async () => {
    await expect(createMockBalanceReader().getTokenBalance(USDC, "CSOMEONEELSE")).resolves.toBe(0n);
  });

  it("rejects a read against an unknown token contract", async () => {
    await expect(createMockBalanceReader().getTokenBalance("CNOTATOKEN", ACCOUNT)).rejects.toThrow(
      /Unknown token contract/,
    );
  });
});

describe("formatBalanceTable", () => {
  it("aligns columns and right-aligns the amounts", () => {
    const table = formatBalanceTable(ACCOUNT, [
      { symbol: "USDC", contractId: USDC, decimals: 7, amount: 1_250_5000000n },
      { symbol: "XLM", contractId: XLM, decimals: 7, amount: 42_0000000n },
    ]);
    const [account, blank, header, rule, usdcRow, xlmRow] = table.split("\n");

    expect(account).toBe(`Account: ${ACCOUNT}`);
    expect(blank).toBe("");
    expect(header).toMatch(/^TOKEN\s+CONTRACT\s+BALANCE$/);
    expect(rule).toBe("-".repeat(header!.length));
    expect(usdcRow).toContain("1250.5");
    expect(xlmRow).toContain("42");
    // Every row is padded to the same width, so the amount column lines up.
    expect(new Set([header!.length, usdcRow!.length, xlmRow!.length]).size).toBe(1);
  });

  it("formats each token with its own decimals", () => {
    const table = formatBalanceTable(ACCOUNT, [
      { symbol: "EURC", contractId: EURC, decimals: 6, amount: 18_750000n },
    ]);
    expect(table).toContain("18.75");
  });
});

describe("printBalances", () => {
  it("prints a row per requested token, in the order given", async () => {
    const table = await printBalances({ accountId: ACCOUNT, tokenContractIds: [XLM, USDC] });
    const rows = table.split("\n").slice(4);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^XLM\s/);
    expect(rows[1]).toMatch(/^USDC\s/);
    expect(rows[0]).toContain("42");
    expect(rows[1]).toContain("1250.5");
  });

  it("shows a zero balance rather than omitting the token", async () => {
    const table = await printBalances({ accountId: "CSTRANGER", tokenContractIds: [USDC] });
    expect(table).toMatch(/USDC\s+\S+\s+0$/);
  });

  it("fails before any read when a token contract is unknown", async () => {
    let reads = 0;
    const counting: BalanceReader = {
      async getTokenBalance() {
        reads++;
        return 0n;
      },
    };

    await expect(
      printBalances({ accountId: ACCOUNT, tokenContractIds: [USDC, "CNOTATOKEN"] }, counting),
    ).rejects.toThrow(/Unknown token contract/);
    expect(reads).toBe(0);
  });

  it("reads through an injected reader, so a caller can supply a live one", async () => {
    const constant: BalanceReader = {
      async getTokenBalance() {
        return 7_0000000n;
      },
    };

    const table = await printBalances(
      { accountId: ACCOUNT, tokenContractIds: [USDC, XLM] },
      constant,
    );
    expect(table.match(/\b7\b/g)).toHaveLength(2);
  });
});
