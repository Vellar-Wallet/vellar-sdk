import { rpc } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { TransactionTimeoutError, waitForTransaction } from "../../src/tx-status";
import { createRpcTxStatusReader } from "./status-reader";

function readerFor(status: unknown, warn = vi.fn()) {
  const getTransaction = vi.fn().mockResolvedValue({ status });
  const reader = createRpcTxStatusReader({
    rpcUrl: "https://rpc.test",
    server: { getTransaction } as never,
    warn,
  });
  return { reader, warn };
}

describe("createRpcTxStatusReader", () => {
  it("maps SUCCESS, FAILED and NOT_FOUND without warning", async () => {
    const { SUCCESS, FAILED, NOT_FOUND } = rpc.Api.GetTransactionStatus;
    const ok = readerFor(SUCCESS);
    expect(await ok.reader.getStatus("h")).toBe("success");
    expect(await readerFor(FAILED).reader.getStatus("h")).toBe("failed");
    const nf = readerFor(NOT_FOUND);
    expect(await nf.reader.getStatus("h")).toBe("pending");
    expect(nf.warn).not.toHaveBeenCalled();
    expect(ok.warn).not.toHaveBeenCalled();
  });

  it("warns and returns pending for an unrecognized status", async () => {
    const { reader, warn } = readerFor("SOMETHING_NEW");
    expect(await reader.getStatus("abc123")).toBe("pending");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("SOMETHING_NEW");
    expect(warn.mock.calls[0][0]).toContain("abc123");
  });

  it("never classifies an unrecognized status as success (regression)", async () => {
    for (const status of ["SUCCESS_PARTIAL", "success", "", undefined, "CONFIRMED"]) {
      const { reader } = readerFor(status);
      expect(await reader.getStatus("h")).not.toBe("success");
    }
  });

  it("an always-unrecognized status ends in a timeout, never a false success", async () => {
    const { reader } = readerFor("SOMETHING_NEW");
    let now = 0;
    await expect(
      waitForTransaction(reader, "h", {
        timeoutMs: 50,
        intervalMs: 10,
        sleep: async (ms) => {
          now += ms;
        },
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(TransactionTimeoutError);
  });
});
