import { describe, expect, it, vi } from "vitest";
import {
  CLI_COMMANDS,
  CLI_ERROR_CODES,
  CLI_EXIT_CODES,
  COMMAND_FAILURES,
  CliError,
  fail,
  handleCommandError,
  sanitizeCliMessage,
  type CliErrorCode,
} from "./cli-errors";

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

  it.each(CLI_COMMANDS)("%s --json emits a single envelope for each of its failure classes", (cmd) => {
    const classes = Object.entries(COMMAND_FAILURES[cmd]) as [
      CliErrorCode,
      { message: string; retryable: boolean },
    ][];
    expect(classes.length).toBeGreaterThan(0);
    for (const [code, spec] of classes) {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
        throw new Error(`exit:${c}`);
      }) as never);

      expect(() =>
        handleCommandError(new CliError(code, spec.message, spec.retryable), true),
      ).toThrow(`exit:${CLI_EXIT_CODES[code]}`);

      const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(printed).toEqual({
        code,
        message: spec.message,
        retryable: spec.retryable,
      });
      expect(printed).not.toHaveProperty("stack");
      expect(errSpy).not.toHaveBeenCalled();
      log.mockRestore();
      errSpy.mockRestore();
      exit.mockRestore();
    }
  });

  it("fail() throws CliError so a command catch can handleCommandError", () => {
    expect(() => fail("REFUSED", "over budget", false)).toThrow(CliError);
  });
});
