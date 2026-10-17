import { afterEach, describe, expect, it, vi } from "vitest";
import { VELLAR_LOG_LEVEL_ENV, VELLAR_LOG_LEVELS, type VellarLogLevel } from "vellar-sdk/logger";
import { loadConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { createSpendLedger } from "../src/ledger.js";
import { divertStdoutToStderr, log, setLogLevel } from "../src/output.js";
import { createPayer } from "../src/payer.js";
import { response402, responsePaid, scriptedFetch, stubSigner, testEnv } from "./helpers.js";

describe("vellar-mcp-x402-payer shared VELLAR_LOG_LEVEL support (#678)", () => {
  afterEach(() => {
    setLogLevel(undefined);
    delete process.env[VELLAR_LOG_LEVEL_ENV];
    vi.restoreAllMocks();
  });

  it("parses VELLAR_LOG_LEVEL in loadConfig and rejects unknown levels with ConfigError", () => {
    const defaultCfg = loadConfig(testEnv());
    expect(defaultCfg.logLevel).toBe("info");

    for (const lvl of VELLAR_LOG_LEVELS) {
      const cfg = loadConfig({ ...testEnv(), [VELLAR_LOG_LEVEL_ENV]: lvl });
      expect(cfg.logLevel).toBe(lvl);
    }

    expect(() =>
      loadConfig({ ...testEnv(), [VELLAR_LOG_LEVEL_ENV]: "trace" }),
    ).toThrow(ConfigError);
  });

  it("scales stderr log volume across silent < error < warn < info < debug while keeping stdout empty", () => {
    const counts: Record<VellarLogLevel, number> = {
      silent: 0,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
    };

    for (const lvl of VELLAR_LOG_LEVELS) {
      let stdout = "";
      const stderrLines: string[] = [];
      const outSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((c: unknown) => ((stdout += String(c)), true));
      const errSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation((c: unknown) => {
          stderrLines.push(String(c).trim());
          return true;
        });

      setLogLevel(lvl);
      log("error", "err-msg");
      log("warn", "warn-msg");
      log("info", "info-msg");
      log("debug", "debug-msg");

      outSpy.mockRestore();
      errSpy.mockRestore();

      expect(stdout).toBe("");
      counts[lvl] = stderrLines.filter(Boolean).length;
    }

    expect(counts).toEqual({
      silent: 0,
      error: 1,
      warn: 2,
      info: 3,
      debug: 4,
    });
  });

  it("emits debug payment logs on stderr and keeps stdout diversion (#416) intact", async () => {
    const config = loadConfig({ ...testEnv(), [VELLAR_LOG_LEVEL_ENV]: "debug" });
    setLogLevel(config.logLevel);
    const ledger = createSpendLedger(config.ceilings);
    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl: scriptedFetch([response402(), responsePaid("hello")]),
    });

    let stdout = "";
    let stderr = "";
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: unknown) => ((stdout += String(c)), true)) as never;
    process.stderr.write = ((c: unknown) => ((stderr += String(c)), true)) as never;

    const restoreDivert = divertStdoutToStderr();
    try {
      await payer.pay("https://res.test/paid", "1000");
      process.stdout.write("[x402] dependency stray stdout write\n");
    } finally {
      restoreDivert();
      process.stdout.write = realOut;
      process.stderr.write = realErr;
    }

    expect(stdout).toBe("");
    expect(stderr).toContain('"level":"debug"');
    expect(stderr).toContain("x402 probe");
    expect(stderr).toContain("x402 signing attempt");
    expect(stderr).toContain("[diverted-stdout]");
  });
});
