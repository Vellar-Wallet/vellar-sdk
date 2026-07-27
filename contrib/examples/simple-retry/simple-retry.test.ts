import { describe, expect, it, vi } from "vitest";
import { simpleRetry } from "./simple-retry";

describe("simpleRetry", () => {
  it("succeeds on the first attempt with no retries needed", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(simpleRetry(fn, 3)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a fixed number of times, then succeeds", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return "success";
    };
    await expect(simpleRetry(fn, 5)).resolves.toBe("success");
    expect(calls).toBe(3);
  });

  it("throws the last error once maxAttempts is exhausted", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });
    await expect(simpleRetry(fn, 3)).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
