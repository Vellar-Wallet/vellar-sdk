import { describe, expect, it } from "vitest";

import { checkReadiness } from "../src/readiness.js";

const VALID_ASSET =
  "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const VALID_SECRET =
  "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

describe("checkReadiness", () => {
  it("reports a ready configuration", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_NETWORK: "testnet",
      VELLAR_X402_ASSETS: `${VALID_ASSET}:1000000`,
    });

    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports missing required configuration", () => {
    const result = checkReadiness({});

    expect(result.ready).toBe(false);

    expect(
      result.issues.map((item) => item.code),
    ).toEqual(
      expect.arrayContaining([
        "missing-secret",
        "missing-assets",
      ]),
    );
  });

  it("reports invalid network", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_NETWORK: "devnet",
      VELLAR_X402_ASSETS: `${VALID_ASSET}:1000000`,
    });

    expect(result.ready).toBe(false);

    expect(
      result.issues.some(
        (item) => item.code === "invalid-network",
      ),
    ).toBe(true);
  });

  it("does not expose the configured secret in readiness errors", () => {
    const secret = "not-a-real-secret-value";

    const result = checkReadiness({
      VELLAR_X402_SECRET: secret,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:1000000`,
    });

    expect(
      JSON.stringify(result),
    ).not.toContain(secret);
  });

  it("rejects policies without a wallet", () => {
    const result = checkReadiness({
      VELLAR_X402_SECRET: VALID_SECRET,
      VELLAR_X402_ASSETS: `${VALID_ASSET}:1000000`,
      VELLAR_X402_POLICIES: VALID_ASSET,
    });

    expect(result.ready).toBe(false);

    expect(
      result.issues.some(
        (item) => item.code === "invalid-policies",
      ),
    ).toBe(true);
  });
});
