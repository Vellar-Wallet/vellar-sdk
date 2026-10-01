// Tests for balances-rpc trustline edge cases — issue #269.
// Mocks @stellar/stellar-sdk to simulate Soroban RPC responses.
// Contributed as per contrib/ rules; tests run via the project's existing vitest suite.

import { describe, expect, it, vi } from "vitest";
import { createBalanceService, type BalanceReader } from "../src/balances";
import { createRpcBalanceReader } from "../src/balances-rpc";

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
    const token = {
      symbol: "USDC",
      contractId: "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3",
      decimals: 7,
    };
    const service = createBalanceService(reader, [token]);
    const balances = await service.getBalances("GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A");
    expect(balances).toEqual([
      {
        symbol: "USDC",
        contractId: "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3",
        decimals: 7,
        amount: 200n,
      },
    ]);
  });

  it("handles a wallet with many trustlines including duplicates", async () => {
    const tokens = [
      { symbol: "XLM", contractId: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND", decimals: 7 },
      { symbol: "USDC", contractId: "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3", decimals: 7 },
      // Same contract ID as USDC — deliberate duplicate to test deduplication / idempotency.
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
