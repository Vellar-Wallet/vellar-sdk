import { afterEach, describe, expect, it, vi } from "vitest";
import { makeInspectCommand } from "./commands/inspect.js";
import {
  createCliLogger,
  VELLAR_LOG_LEVEL_ENV,
  VELLAR_LOG_LEVELS,
  type VellarLogLevel,
} from "./logger.js";

const VALID_TX_HASH =
  "a1b2c3d4e5f60123456789abcdef0123456789abcdef0123456789abcdef0123";

describe("vellar-cli shared VELLAR_LOG_LEVEL support (#678)", () => {
  afterEach(() => {
    delete process.env[VELLAR_LOG_LEVEL_ENV];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("changes CLI logger output volume with VELLAR_LOG_LEVEL", () => {
    const counts: Record<VellarLogLevel, number> = {
      silent: 0,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
    };

    for (const lvl of VELLAR_LOG_LEVELS) {
      const lines: string[] = [];
      const logger = createCliLogger({
        env: { [VELLAR_LOG_LEVEL_ENV]: lvl },
        sink: (_level, line) => lines.push(line),
      });

      logger.error("cli error");
      logger.warn("cli warn");
      logger.info("cli info");
      logger.debug("cli debug");

      counts[lvl] = lines.length;
    }

    expect(counts).toEqual({
      silent: 0,
      error: 1,
      warn: 2,
      info: 3,
      debug: 4,
    });
  });

  it("emits more stderr log lines in inspect command as VELLAR_LOG_LEVEL increases from silent to debug", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          hash: VALID_TX_HASH,
          successful: true,
          ledger: 12345,
          fee_charged: "100",
          source_account: "GAAA",
          fee_account: "GBBB",
          created_at: "2026-10-17T00:00:00Z",
        }),
      })
    );

    async function runInspectWithLevel(level: VellarLogLevel): Promise<string[]> {
      process.env[VELLAR_LOG_LEVEL_ENV] = level;
      const lines: string[] = [];
      const spy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation((chunk: unknown) => {
          lines.push(String(chunk).trim());
          return true;
        });
      try {
        await makeInspectCommand().parseAsync([
          "node",
          "inspect",
          VALID_TX_HASH,
          "--json",
        ]);
      } finally {
        spy.mockRestore();
      }
      return lines.filter(Boolean);
    }

    const silentLines = await runInspectWithLevel("silent");
    const warnLines = await runInspectWithLevel("warn");
    const infoLines = await runInspectWithLevel("info");
    const debugLines = await runInspectWithLevel("debug");

    expect(silentLines).toHaveLength(0);
    expect(warnLines).toHaveLength(0);
    expect(infoLines).toHaveLength(1);
    expect(debugLines).toHaveLength(2);
    expect(debugLines[0]).toContain("querying Horizon transaction endpoint");
    expect(debugLines[1]).toContain("inspected transaction");
  });
});
