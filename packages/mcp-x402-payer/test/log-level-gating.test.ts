import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../src/output.js";

// Covers the shared VELLAR_LOG_LEVEL convention (#678) as it applies to this
// package's own stderr-only logger (output.ts's log()). The gating itself
// (shouldLog, getConfiguredLogLevel) is tested directly in
// vellar-sdk/src/log-level.test.ts; this file only checks that this
// package's log() actually consults it before writing.

const originalLogLevel = process.env.VELLAR_LOG_LEVEL;

afterEach(() => {
  if (originalLogLevel === undefined) {
    delete process.env.VELLAR_LOG_LEVEL;
  } else {
    process.env.VELLAR_LOG_LEVEL = originalLogLevel;
  }
  vi.restoreAllMocks();
});

describe("log() respects VELLAR_LOG_LEVEL", () => {
  it("writes an 'info' message when VELLAR_LOG_LEVEL is unset (default threshold)", () => {
    delete process.env.VELLAR_LOG_LEVEL;
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    log("info", "hello");

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("suppresses 'info' and 'warn' when VELLAR_LOG_LEVEL=error", () => {
    process.env.VELLAR_LOG_LEVEL = "error";
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    log("info", "hello");
    log("warn", "still suppressed");

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("still writes 'error' when VELLAR_LOG_LEVEL=error", () => {
    process.env.VELLAR_LOG_LEVEL = "error";
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    log("error", "a real failure");

    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("VELLAR_LOG_LEVEL=silent suppresses every level, including error", () => {
    process.env.VELLAR_LOG_LEVEL = "silent";
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    log("error", "nothing gets out");

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("VELLAR_LOG_LEVEL=debug does not suppress info/warn (debug is the lowest tier)", () => {
    process.env.VELLAR_LOG_LEVEL = "debug";
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    log("info", "hello");
    log("warn", "also hello");

    expect(writeSpy).toHaveBeenCalledTimes(2);
  });
});
