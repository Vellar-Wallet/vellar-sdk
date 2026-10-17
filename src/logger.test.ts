import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVellarLogger,
  parseVellarLogLevel,
  resolveVellarLogLevel,
  shouldEmitLog,
  VELLAR_LOG_LEVEL_ENV,
  VELLAR_LOG_LEVELS,
  type VellarLogLevel,
} from "./logger";

describe("shared VELLAR_LOG_LEVEL contract (#678)", () => {
  afterEach(() => {
    delete process.env[VELLAR_LOG_LEVEL_ENV];
    vi.restoreAllMocks();
  });

  it("parses all five canonical log levels case-insensitively and rejects invalid values", () => {
    for (const lvl of VELLAR_LOG_LEVELS) {
      expect(parseVellarLogLevel(lvl)).toBe(lvl);
      expect(parseVellarLogLevel(`  ${lvl.toUpperCase()}  `)).toBe(lvl);
    }
    expect(parseVellarLogLevel(undefined, "warn")).toBe("warn");
    expect(parseVellarLogLevel("", "info")).toBe("info");
    expect(() => parseVellarLogLevel("verbose")).toThrow(/Invalid VELLAR_LOG_LEVEL/);
  });

  it("monotonically increases log output volume across silent < error < warn < info < debug", () => {
    const counts: Record<VellarLogLevel, number> = {
      silent: 0,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
    };

    for (const configuredLevel of VELLAR_LOG_LEVELS) {
      const lines: string[] = [];
      const logger = createVellarLogger({
        env: { [VELLAR_LOG_LEVEL_ENV]: configuredLevel },
        component: "vellar-sdk",
        sink: (_lvl, line) => lines.push(line),
      });

      logger.error("err-1");
      logger.warn("warn-1");
      logger.info("info-1");
      logger.debug("debug-1");

      counts[configuredLevel] = lines.length;
    }

    expect(counts).toEqual({
      silent: 0,
      error: 1,
      warn: 2,
      info: 3,
      debug: 4,
    });
  });

  it("defaults to writing to process.stderr and never process.stdout", () => {
    let stdout = "";
    let stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    });

    const logger = createVellarLogger({
      env: { [VELLAR_LOG_LEVEL_ENV]: "debug" },
    });
    logger.debug("debug-check", { step: "quote" });

    expect(stdout).toBe("");
    expect(stderr).toContain("debug-check");
    expect(resolveVellarLogLevel({ [VELLAR_LOG_LEVEL_ENV]: "debug" })).toBe("debug");
    expect(shouldEmitLog("warn", "error")).toBe(true);
    expect(shouldEmitLog("warn", "info")).toBe(false);
  });
});
