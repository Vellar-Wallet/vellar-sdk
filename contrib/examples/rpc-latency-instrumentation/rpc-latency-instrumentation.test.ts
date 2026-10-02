import { describe, it, expect } from "vitest";
import { instrumentRpcCall, type RequestCompleteInfo } from "./rpc-latency-instrumentation";

describe("Issue #252 — RPC Latency Instrumentation", () => {
  it("records duration for successful and failed calls", async () => {
    const records: RequestCompleteInfo[] = [];
    const hook = (info: RequestCompleteInfo) => records.push(info);

    await instrumentRpcCall("simulate", async () => "ok", hook);
    expect(records).toHaveLength(1);
    expect(records[0].method).toBe("simulate");
    expect(records[0].success).toBe(true);

    await expect(
      instrumentRpcCall("sendTx", async () => {
        throw new Error("fail");
      }, hook)
    ).rejects.toThrow("fail");

    expect(records).toHaveLength(2);
    expect(records[1].method).toBe("sendTx");
    expect(records[1].success).toBe(false);
  });
});
