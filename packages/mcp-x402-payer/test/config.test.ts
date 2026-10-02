import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { ASSET_A, ASSET_B, freshSecret, testEnv } from "./helpers.js";

describe("loadConfig — secret handling", () => {
  it("keeps the secret NON-ENUMERABLE so it cannot be serialized out by accident", () => {
    const secret = freshSecret();
    const config = loadConfig(testEnv({ secret }));

    // Readable deliberately...
    expect(config.secret).toBe(secret);
    // ...but invisible to every accidental export path.
    expect(JSON.stringify(config)).not.toContain(secret);
    expect(Object.keys(config)).not.toContain("secret");
    expect(JSON.stringify({ ...config })).not.toContain(secret);
    expect(Object.entries(config).map(([k]) => k)).not.toContain("secret");
  });

  it("rejects a malformed secret WITHOUT echoing it", () => {
    const bogus = "SNOTAREALSECRETVALUE12345";
    try {
      loadConfig(testEnv({ secret: bogus }));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).not.toContain(bogus);
      expect((err as Error).message).toMatch(/not a valid Stellar ed25519 secret seed/);
    }
  });

  it("requires a secret", () => {
    const env = testEnv();
    delete env.VELLAR_X402_SECRET;
    expect(() => loadConfig(env)).toThrow(/No payer secret configured/);
  });

  it("refuses both VELLAR_X402_SECRET and VELLAR_X402_SECRET_FILE at once", () => {
    const env = { ...testEnv(), VELLAR_X402_SECRET_FILE: "/tmp/nope" };
    expect(() => loadConfig(env)).toThrow(/exactly one of/);
  });

  it("reports the PATH but never the contents when the secret file is unreadable", () => {
    const env = testEnv();
    delete env.VELLAR_X402_SECRET;
    env.VELLAR_X402_SECRET_FILE = "/definitely/not/a/real/path";
    expect(() => loadConfig(env)).toThrow(/could not be read \(\/definitely\/not\/a\/real\/path\)/);
  });
});

describe("loadConfig — per-asset ceilings", () => {
  it("parses assets and ceilings into a map", () => {
    const config = loadConfig(testEnv());
    expect(config.ceilings.get(ASSET_A)).toBe(1_000_000n);
    expect(config.ceilings.get(ASSET_B)).toBe(500n);
    expect(config.allowedAssets).toEqual([ASSET_A, ASSET_B]);
  });

  it("requires at least one asset — no asset means nothing is payable", () => {
    expect(() => loadConfig(testEnv({ assets: "" }))).toThrow(/is required/);
    expect(() => loadConfig(testEnv({ assets: "  ,  " }))).toThrow(/at least one/i);
  });

  it("rejects an asset with no ceiling, rather than defaulting to unlimited", () => {
    // Failing closed is the whole point: a missing ceiling must never mean "any".
    expect(() => loadConfig(testEnv({ assets: ASSET_A }))).toThrow(/malformed/);
  });

  it("rejects a non-contract asset id", () => {
    expect(() =>
      loadConfig(testEnv({ assets: "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A:100" })),
    ).toThrow(/not a Soroban contract id/);
  });

  it("rejects a non-integer ceiling", () => {
    expect(() => loadConfig(testEnv({ assets: `${ASSET_A}:1.5` }))).toThrow(/non-negative integer/);
    expect(() => loadConfig(testEnv({ assets: `${ASSET_A}:1e6` }))).toThrow(/non-negative integer/);
  });

  it("rejects a zero ceiling as a configuration mistake", () => {
    expect(() => loadConfig(testEnv({ assets: `${ASSET_A}:0` }))).toThrow(/would refuse every payment/);
  });

  it("rejects a duplicated asset rather than silently picking one", () => {
    expect(() => loadConfig(testEnv({ assets: `${ASSET_A}:100,${ASSET_A}:200` }))).toThrow(
      /more than once/,
    );
  });

  it("preserves ceilings beyond Number.MAX_SAFE_INTEGER", () => {
    const big = "9007199254740993000";
    const config = loadConfig(testEnv({ assets: `${ASSET_A}:${big}` }));
    expect(config.ceilings.get(ASSET_A)).toBe(BigInt(big));
  });
});

describe("loadConfig — network and limits", () => {
  it("defaults to testnet", () => {
    const env = testEnv();
    delete env.VELLAR_X402_NETWORK;
    const config = loadConfig(env);
    expect(config.network).toBe("testnet");
    expect(config.caip2).toBe("stellar:testnet");
  });

  it("maps mainnet to the pubnet CAIP-2 id", () => {
    const config = loadConfig(testEnv({ network: "mainnet" }));
    expect(config.caip2).toBe("stellar:pubnet");
  });

  it("rejects an unknown network", () => {
    expect(() => loadConfig(testEnv({ network: "futurenet" }))).toThrow(/must be "testnet" or "mainnet"/);
  });

  it("defaults and validates the response byte cap", () => {
    expect(loadConfig(testEnv()).maxResponseBytes).toBe(262_144);
    expect(loadConfig(testEnv({ maxResponseBytes: "1024" })).maxResponseBytes).toBe(1024);
    expect(() => loadConfig(testEnv({ maxResponseBytes: "-1" }))).toThrow(/positive integer/);
    expect(() => loadConfig(testEnv({ maxResponseBytes: "abc" }))).toThrow(/positive integer/);
  });
});
