import { describe, expect, it, vi } from "vitest";
import {
  CLI_ERROR_CODES,
  CLI_EXIT_CODES,
  CliError,
  handleCommandError,
  sanitizeCliMessage,
} from "./errors.js";

describe("CLI error contract (#411)", () => {
  it("exports a fixed code list, not per-call-site strings", () => {
    expect(CLI_ERROR_CODES).toEqual([
      "USAGE",
      "REFUSED",
      "NETWORK",
      "PAYMENT_MAY_HAVE_SETTLED",
    ]);
    expect(CLI_EXIT_CODES.USAGE).toBe(2);
    expect(CLI_EXIT_CODES.REFUSED).toBe(3);
    expect(CLI_EXIT_CODES.NETWORK).toBe(4);
    expect(CLI_EXIT_CODES.PAYMENT_MAY_HAVE_SETTLED).toBe(5);
    expect(CLI_EXIT_CODES.REFUSED).not.toBe(CLI_EXIT_CODES.PAYMENT_MAY_HAVE_SETTLED);
  });

  it("never keeps a secret or a stack frame in the envelope", () => {
    const secret = "SDABELWZ4DABVQRAO2IH6GXLHIJADWG7ZEXRWBBV5JRJBZMSGYU5IQ33";
    const cleaned = sanitizeCliMessage(`boom ${secret}\n    at Object.run (pay.ts:1:1)`);
    expect(cleaned).not.toMatch(/S[A-Z2-7]{55}/);
    expect(cleaned).not.toMatch(/at Object\.run/);
    expect(cleaned).toMatch(/\[redacted\]/);
  });

  it("emits a single JSON object on stdout for a post-signature failure", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() =>
      handleCommandError(new CliError("PAYMENT_MAY_HAVE_SETTLED", "may have settled", false), true),
    ).toThrow("exit:5");

    const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(printed).toEqual({
      code: "PAYMENT_MAY_HAVE_SETTLED",
      message: "may have settled",
      retryable: false,
    });
    expect(errSpy).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(5);
    log.mockRestore();
    errSpy.mockRestore();
    exit.mockRestore();
  });
});
