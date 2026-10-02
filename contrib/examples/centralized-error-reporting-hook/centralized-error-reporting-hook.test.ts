import { describe, it, expect, vi } from "vitest";
import { ClientWithErrorReporting } from "./centralized-error-reporting-hook";

describe("Issue #251 — Centralized Error Reporting Hook", () => {
  it("calls onError when an operation fails", async () => {
    const onError = vi.fn();
    const client = new ClientWithErrorReporting(onError);

    await expect(
      client.execute(async () => {
        throw new Error("RPC failure");
      }, { method: "sendTransaction" })
    ).rejects.toThrow("RPC failure");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { method: "sendTransaction" });
  });
});
