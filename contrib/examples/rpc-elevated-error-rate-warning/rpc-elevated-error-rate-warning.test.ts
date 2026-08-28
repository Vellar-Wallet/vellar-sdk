import { describe, it, expect, vi } from "vitest";
import { RpcErrorRateMonitor, type ErrorRateStats } from "./rpc-elevated-error-rate-warning";

describe("Issue #254 — Elevated Error Rate Warning", () => {
  it("fires callback when error rate exceeds threshold", () => {
    const callback = vi.fn();
    const monitor = new RpcErrorRateMonitor(0.3, 10, callback);

    for (let i = 0; i < 4; i++) {
      monitor.record(true);
    }
    expect(callback).not.toHaveBeenCalled();

    monitor.record(false);
    monitor.record(false); // 2/6 = 33.3% > 30%

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
