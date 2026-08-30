import { describe, expect, it, vi } from "vitest";
import { createBalanceService, formatTokenAmount, type BalanceReader } from "./balances";
import { createRpcBalanceReader } from "./balances-rpc";
import { scValToBigInt } from "@stellar/stellar-sdk";

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...original,
    rpc: {
      ...original.rpc,
      Server: vi.fn().mockImplementation(() => ({
        simulateTransaction: vi.fn().mockImplementation(async (tx) => {
          const op = tx.operations[0];
          const scAddress = op.func._value._attributes.contractAddress;
          const contractId = original.Address.fromScAddress(scAddress).toString();
          return {
            result: {
              retval: { contractId }
            }
          };
        })
      })),
      Api: {
        ...original.rpc.Api,
        isSimulationSuccess: vi.fn().mockReturnValue(true)
      }
    },
    scValToBigInt: vi.fn().mockImplementation((val: any) => {
      if (val && typeof val === "object" && "contractId" in val) {
        if (val.contractId === "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND") return 100n;
        if (val.contractId === "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3") return 200n;
        if (val.contractId === "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA") return 300n;
      }
      return 0n;
    })
  };
});

describe("formatTokenAmount", () => {
  it.each([
    [0n, 7, "0"],
    [100000000000n, 7, "10000"],
    [10000001n, 7, "1.0000001"],
    [1n, 7, "0.0000001"],
    [12345000n, 7, "1.2345"],
    [-25000000n, 7, "-2.5"],
    [42n, 0, "42"],
  ])("formats %s with %s decimals as %s", (amount, decimals, expected) => {
    expect(formatTokenAmount(amount, decimals)).toBe(expected);
  });

  it("rejects invalid decimals", () => {
    expect(() => formatTokenAmount(1n, -1)).toThrow(RangeError);
    expect(() => formatTokenAmount(1n, 1.5)).toThrow(RangeError);
  });
});

describe("createBalanceService", () => {
  const xlm = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };
  const usdc = { symbol: "USDC", contractId: "CUSDC", decimals: 7 };

  it("reads every configured token for the holder", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi
        .fn()
        .mockImplementation(async (contractId: string) => (contractId === "CNATIVE" ? 5n : 7n)),
    };
    const service = createBalanceService(reader, [xlm, usdc]);

    await expect(service.getBalances("CHOLDER")).resolves.toEqual([
      { ...xlm, amount: 5n },
      { ...usdc, amount: 7n },
    ]);
    expect(reader.getTokenBalance).toHaveBeenCalledWith("CNATIVE", "CHOLDER");
    expect(reader.getTokenBalance).toHaveBeenCalledWith("CUSDC", "CHOLDER");
  });

  it("propagates reader failures", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi.fn().mockRejectedValue(new Error("rpc down")),
    };
    await expect(createBalanceService(reader, [xlm]).getBalances("CHOLDER")).rejects.toThrow(
      "rpc down",
    );
  });

  it("returns an empty list when no tokens are configured", async () => {
    const reader: BalanceReader = { getTokenBalance: vi.fn() };
    await expect(createBalanceService(reader, []).getBalances("CHOLDER")).resolves.toEqual([]);
    expect(reader.getTokenBalance).not.toHaveBeenCalled();
  });
});

describe("RpcBalanceReader trustline edge cases", () => {
  const reader = createRpcBalanceReader({
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  });

  it("handles a wallet with zero trustlines (zero tokens)", async () => {
    const service = createBalanceService(reader, []);
    const balances = await service.getBalances("GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A");
    expect(balances).toEqual([]);
  });

  it("handles a wallet with a single trustline", async () => {
    const token = { symbol: "USDC", contractId: "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3", decimals: 7 };
    const service = createBalanceService(reader, [token]);
    const balances = await service.getBalances("GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A");
    expect(balances).toEqual([
      { symbol: "USDC", contractId: "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3", decimals: 7, amount: 200n },
    ]);
  });

  it("handles a wallet with many trustlines including duplicates", async () => {
    const tokens = [
      { symbol: "XLM", contractId: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND", decimals: 7 },
      { symbol: "USDC", contractId: "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3", decimals: 7 },
      { symbol: "USDC-DUP", contractId: "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3", decimals: 7 },
      { symbol: "EUR", contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", decimals: 7 },
    ];
    const service = createBalanceService(reader, tokens);
    const balances = await service.getBalances("GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A");
    expect(balances).toEqual([
      { symbol: "XLM", contractId: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND", decimals: 7, amount: 100n },
      { symbol: "USDC", contractId: "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3", decimals: 7, amount: 200n },
      { symbol: "USDC-DUP", contractId: "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3", decimals: 7, amount: 200n },
      { symbol: "EUR", contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", decimals: 7, amount: 300n },
    ]);
  });
});

