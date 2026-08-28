import { describe, it, expect, vi } from "vitest";
import {
  RpcErrorRateTracker,
  withRpcInstrumentation,
  type RequestCompleteInfo,
  type ElevatedErrorRateStats,
} from "./instrumentation";

describe("Issues #251, #252, #254 — Instrumentation & Observability Hooks", () => {
  it("invokes onError hook when an RPC call fails (#251)", async () => {
    const onError = vi.fn();
    const failingCall = async () => {
      throw new Error("RPC node unreachable");
    };

    await expect(
      withRpcInstrumentation("sendTransaction", failingCall, { onError })
    ).rejects.toThrow("RPC node unreachable");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ method: "sendTransaction" })
    );
  });

  it("invokes onRequestComplete hook with duration for success and failure (#252)", async () => {
    const completions: RequestCompleteInfo[] = [];
    const onRequestComplete = (info: RequestCompleteInfo) => completions.push(info);

    // Successful call
    await withRpcInstrumentation(
      "getTransaction",
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { status: "success" };
      },
      { onRequestComplete }
    );

    expect(completions).toHaveLength(1);
    expect(completions[0].method).toBe("getTransaction");
    expect(completions[0].success).toBe(true);
    expect(completions[0].durationMs).toBeGreaterThanOrEqual(8);

    // Failed call
    await expect(
      withRpcInstrumentation(
        "getTransaction",
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          throw new Error("Timeout");
        },
        { onRequestComplete }
      )
    ).rejects.toThrow("Timeout");

    expect(completions).toHaveLength(2);
    expect(completions[1].success).toBe(false);
    expect(completions[1].error?.message).toBe("Timeout");
  });

  it("tracks rolling error rate and invokes onElevatedErrorRate above threshold (#254)", () => {
    const alerts: ElevatedErrorRateStats[] = [];
    const tracker = new RpcErrorRateTracker({
      threshold: 0.3, // 30%
      windowSize: 10,
      onElevatedErrorRate: (stats) => alerts.push(stats),
    });

    // 4 successes
    for (let i = 0; i < 4; i++) {
      tracker.record(true);
    }
    expect(alerts).toHaveLength(0);

    // 2 failures (2 out of 6 = 33.3% > 30%)
    tracker.record(false);
    tracker.record(false);

    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0].errorRate).toBeGreaterThanOrEqual(0.3);
    expect(alerts[0].threshold).toBe(0.3);
  });
});
