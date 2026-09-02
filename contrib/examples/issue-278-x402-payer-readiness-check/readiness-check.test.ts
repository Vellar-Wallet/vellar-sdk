import { describe, expect, it } from "vitest";
import { checkReadiness } from "./readiness-check";

const VALID_SECRET = "SBPTZAOFHOKY7ZZE7HGXXVGWCVTAMLLI4KYY2EI7DGZY6L4KTAWWZ2XY";
const VALID_ASSET = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const VALID_WALLET = "CATOMTOMTOMTOMTOMTOMTOMTOMTOMTOMTOMTOMTOMTOMTOMTOMTOMTOM";
const VALID_POLICY = "CPOLICYPOLICYPOLICYPOLICYPOLICYPOLICYPOLICYPOLICYPOLICYX";

describe("checkReadiness", () => {
  it("reports ready with no issues for a fully valid configuration", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
      VELLAR_X402_NETWORK: "testnet",
    });
    expect(result).toEqual({ ready: true, issues: [] });
  });

  it("is ready when the secret is sourced from a file", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET_FILE: "/run/secrets/x402-payer-key",
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
    });
    expect(result.ready).toBe(true);
  });

  it("is not ready on a completely empty environment", () => {
    const result = checkReadiness({});
    expect(result.ready).toBe(false);
    expect(result.issues.map((i) => i.variable)).toEqual(
      expect.arrayContaining(["VELLAR_X402_SECRET", "VELLAR_X402_ASSETS"]),
    );
  });

  it("flags setting both secret and secret file", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_SECRET_FILE: "/run/secrets/x402-payer-key",
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ variable: "VELLAR_X402_SECRET / VELLAR_X402_SECRET_FILE" }),
    );
  });

  it("flags a malformed secret", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: "not-a-real-secret",
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_SECRET" }));
  });

  it("never echoes the secret value in any issue message", () => {
    const secretLike = "SSHOULDNEVERAPPEARINOUTPUTSSHOULDNEVERAPPEARINOUTPUT123";
    const result = checkReadiness({
      VELLAR_X402_SECRET: secretLike,
      VELLAR_X402_ASSETS: "not-valid",
    });
    const serialized = JSON.stringify(result);
    expect(serialized.includes(secretLike)).toBe(false);
  });

  it("flags an invalid network value", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
      VELLAR_X402_NETWORK: "devnet",
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_NETWORK" }));
  });

  it("flags a missing VELLAR_X402_ASSETS", () => {
    const result = checkReadiness({ VELLAR_X402_SECRET: VALID_SECRET });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_ASSETS" }));
  });

  it("flags a malformed VELLAR_X402_ASSETS entry", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: "not-an-entry",
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_ASSETS" }));
  });

  it("flags a zero ceiling", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:0`,
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_ASSETS" }));
  });

  it("flags a duplicated asset", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:1000,${VALID_ASSET}:2000`,
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_ASSETS" }));
  });

  it("flags an invalid wallet address", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
      VELLAR_X402_WALLET: "not-a-contract-id",
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_WALLET" }));
  });

  it("is ready with a valid wallet and matching policies", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
      VELLAR_X402_WALLET: VALID_WALLET,
      VELLAR_X402_POLICIES: VALID_POLICY,
    });
    expect(result).toEqual({ ready: true, issues: [] });
  });

  it("flags policies set without a wallet", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
      VELLAR_X402_POLICIES: VALID_POLICY,
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_POLICIES" }));
  });

  it("flags an invalid policy contract id", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
      VELLAR_X402_WALLET: VALID_WALLET,
      VELLAR_X402_POLICIES: "not-a-contract-id",
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_POLICIES" }));
  });

  it("flags a non-positive VELLAR_X402_MAX_RESPONSE_BYTES", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:5000000`,
      VELLAR_X402_MAX_RESPONSE_BYTES: "0",
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ variable: "VELLAR_X402_MAX_RESPONSE_BYTES" }));
  });
});
