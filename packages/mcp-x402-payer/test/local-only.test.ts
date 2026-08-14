// The localhost guard is tested in the HERMETIC suite, not the integration one.
//
// A safety check that only runs when the thing it protects is already being
// exercised is not a safety check. These cases run on every `npm test`.

import { describe, expect, it } from "vitest";
import {
  NonLocalEndpointError,
  assertLocalEndpoints,
  isLocalUrl,
  readIntegrationEnv,
} from "./integration/local-only.js";

describe("isLocalUrl", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000/verify",
    "http://127.1.2.3:8080",
    "https://0.0.0.0:443",
    "http://[::1]:3000",
    "http://facilitator.localhost:3000",
  ])("accepts %s", (url) => {
    expect(isLocalUrl(url)).toBe(true);
  });

  it.each([
    "https://facilitator.vellar.xyz",
    "https://x402.org/facilitator",
    "http://192.168.1.10:3000",
    "http://10.0.0.5:3000",
    "http://example.com",
    // The shapes a near-miss typo produces — these must NOT slip through.
    "http://localhost.evil.com",
    "http://127.0.0.1.evil.com",
    "http://notlocalhost",
    "not a url at all",
    "",
  ])("rejects %s", (url) => {
    expect(isLocalUrl(url)).toBe(false);
  });
});

describe("assertLocalEndpoints", () => {
  it("passes when every endpoint is local", () => {
    expect(() =>
      assertLocalEndpoints({
        facilitator: "http://127.0.0.1:3000",
        seller: "http://localhost:4000/paid",
      }),
    ).not.toThrow();
  });

  it("throws naming the offending endpoint", () => {
    try {
      assertLocalEndpoints({
        facilitator: "http://127.0.0.1:3000",
        seller: "https://facilitator.vellar.xyz",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NonLocalEndpointError);
      expect((err as Error).message).toContain("seller");
      expect((err as Error).message).toContain("PERMANENT public catalog entry");
    }
  });
});

describe("readIntegrationEnv", () => {
  const full = {
    VELLAR_X402_FACILITATOR_URL: "http://127.0.0.1:3000",
    VELLAR_X402_SELLER_URL: "http://127.0.0.1:4000/paid",
    // Deliberately NOT seed-shaped: readIntegrationEnv only checks presence
    // (validation is loadConfig's job), and a secret-shaped literal in the repo
    // is indistinguishable from a real leaked key to whoever reads it next.
    VELLAR_X402_SECRET: "not-a-real-secret-placeholder",
    VELLAR_X402_TEST_ASSET: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  };

  it("returns null when nothing is configured (so the suite can skip)", () => {
    expect(readIntegrationEnv({})).toBeNull();
  });

  it("returns the config when fully set and local", () => {
    expect(readIntegrationEnv(full)?.facilitatorUrl).toBe("http://127.0.0.1:3000");
  });

  it("ERRORS on a partially-set environment rather than skipping", () => {
    // A half-set environment is how a test quietly stops covering anything.
    const partial = { ...full };
    delete (partial as Record<string, string>).VELLAR_X402_SELLER_URL;
    expect(() => readIntegrationEnv(partial)).toThrow(/only partially set/);
  });

  it("refuses a hosted facilitator even when everything else is valid", () => {
    expect(() =>
      readIntegrationEnv({ ...full, VELLAR_X402_FACILITATOR_URL: "https://facilitator.vellar.xyz" }),
    ).toThrow(NonLocalEndpointError);
  });

  it("refuses a hosted seller even when the facilitator is local", () => {
    expect(() =>
      readIntegrationEnv({ ...full, VELLAR_X402_SELLER_URL: "https://api.example.com/paid" }),
    ).toThrow(NonLocalEndpointError);
  });
});
