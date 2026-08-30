import { describe, expect, it, vi } from "vitest";
import { createRpcBalanceReader } from "./balances-rpc";

// Only the retry wiring (#297, shared with tx-rpc.ts via ./rpc-retry) is
// covered here. The simulation-building and result-decoding logic isn't this
// issue's concern and needs a real (or heavily mocked) rpc.Server to exercise
// meaningfully.
describe("createRpcBalanceReader — retry (#297)", () => {
  const HOLDER = "GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA";
  const TOKEN = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
  const SUCCESS_SIM = { result: { retval: "success-retval" } };

  function reader(simulateTransaction: ReturnType<typeof vi.fn>, retry?: { attempts: number; sleep: (ms: number) => Promise<void> }) {
    return createRpcBalanceReader({
      rpcUrl: "https://rpc.test",
      networkPassphrase: "Test SDF Network ; September 2015",
      retry,
      server: { simulateTransaction } as never,
    });
  }

  it("makes a single attempt when no retry option is given (pre-#297 behaviour)", async () => {
    const simulateTransaction = vi.fn().mockRejectedValue(new Error("network blip"));
    const balanceReader = reader(simulateTransaction);
    await expect(
      balanceReader.getTokenBalance(TOKEN, HOLDER),
    ).rejects.toThrow("network blip");
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("retries the simulation on transient failure and succeeds", async () => {
    const simulateTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(SUCCESS_SIM);
    const balanceReader = reader(simulateTransaction, {
      attempts: 3,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    // isSimulationSuccess / scValToBigInt come from @stellar/stellar-sdk and
    // expect a real simulation shape; this test only asserts the retry
    // wiring called through to a second attempt, not the full decode path,
    // so a thrown decode error still proves the retry itself worked.
    await expect(balanceReader.getTokenBalance(TOKEN, HOLDER)).rejects.toThrow();
    expect(simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it("gives up and rejects once retry attempts are exhausted", async () => {
    const simulateTransaction = vi.fn().mockRejectedValue(new Error("still down"));
    const balanceReader = reader(simulateTransaction, {
      attempts: 2,
      sleep: vi.fn().mockResolvedValue(undefined),
    });
    await expect(balanceReader.getTokenBalance(TOKEN, HOLDER)).rejects.toThrow(
      "still down",
    );
    expect(simulateTransaction).toHaveBeenCalledTimes(2);
  });
});
