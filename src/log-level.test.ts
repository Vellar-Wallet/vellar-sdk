// Tests for the shared VELLAR_LOG_LEVEL convention (#678). No network, no
// Node globals referenced directly here either, env is passed explicitly
// to getConfiguredLogLevel, matching how the module itself reads
// globalThis.process.env rather than a bare `process` identifier.

import { describe, expect, it } from "vitest";
import { getConfiguredLogLevel, shouldLog } from "./log-level";

describe("getConfiguredLogLevel", () => {
  it("defaults to 'info' when VELLAR_LOG_LEVEL is unset", () => {
    expect(getConfiguredLogLevel({})).toBe("info");
  });

  it("accepts each recognised level", () => {
    for (const level of ["debug", "info", "warn", "error", "silent"]) {
      expect(getConfiguredLogLevel({ VELLAR_LOG_LEVEL: level })).toBe(level);
    }
  });

  it("is case-insensitive", () => {
    expect(getConfiguredLogLevel({ VELLAR_LOG_LEVEL: "DEBUG" })).toBe("debug");
    expect(getConfiguredLogLevel({ VELLAR_LOG_LEVEL: "WaRn" })).toBe("warn");
  });

  it("falls back to 'info' for an unrecognised value rather than throwing", () => {
    expect(getConfiguredLogLevel({ VELLAR_LOG_LEVEL: "verbose" })).toBe("info");
  });

  it("trims surrounding whitespace", () => {
    expect(getConfiguredLogLevel({ VELLAR_LOG_LEVEL: "  warn  " })).toBe("warn");
  });
});

describe("shouldLog", () => {
  it("logs everything at or above the threshold", () => {
    expect(shouldLog("debug", "debug")).toBe(true);
    expect(shouldLog("info", "debug")).toBe(true);
    expect(shouldLog("warn", "debug")).toBe(true);
    expect(shouldLog("error", "debug")).toBe(true);
  });

  it("drops anything below the threshold", () => {
    expect(shouldLog("debug", "info")).toBe(false);
    expect(shouldLog("info", "warn")).toBe(false);
    expect(shouldLog("warn", "error")).toBe(false);
  });

  it("'silent' as the threshold drops every level, including error", () => {
    expect(shouldLog("debug", "silent")).toBe(false);
    expect(shouldLog("info", "silent")).toBe(false);
    expect(shouldLog("warn", "silent")).toBe(false);
    expect(shouldLog("error", "silent")).toBe(false);
  });

  it("uses the configured (env-derived) threshold when none is passed explicitly", () => {
    // No VELLAR_LOG_LEVEL set in this test's process -> defaults to "info".
    expect(shouldLog("debug")).toBe(false);
    expect(shouldLog("info")).toBe(true);
  });
});
