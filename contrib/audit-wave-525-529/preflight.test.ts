import { describe, expect, it } from "vitest";
import { checkExpectedNetwork, decodeChallenge, formatResults } from "./preflight.js";
import { DEFAULT_FACILITATOR_URL, buildDiscoverySearchUrl } from "./facilitator.js";

describe("preflight", () => {
  it("decodes a base64 challenge header", () => {
    const header = Buffer.from(JSON.stringify({ accepts: [{ network: "stellar:pubnet" }] })).toString("base64");
    expect(decodeChallenge(header, "")?.accepts?.[0]?.network).toBe("stellar:pubnet");
  });

  it("returns null when nothing decodes", () => {
    expect(decodeChallenge(null, "not json")).toBeNull();
  });

  it("fails a host on the wrong network", () => {
    const r = checkExpectedNetwork(
      { target: "x", ok: true, networks: ["stellar:pubnet"], detail: "ok" },
      "testnet",
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("mainnet");
  });

  it("formats PASS/FAIL lines", () => {
    expect(formatResults([{ target: "x", ok: false, networks: [], detail: "down" }])).toBe("FAIL  x  down");
  });
});

describe("facilitator defaults", () => {
  it("builds the search URL with `query`", () => {
    const u = buildDiscoverySearchUrl(DEFAULT_FACILITATOR_URL, "weather", 10);
    expect(u.pathname).toBe("/discovery/search");
    expect(u.searchParams.get("query")).toBe("weather");
    expect(u.searchParams.get("limit")).toBe("10");
  });
});
