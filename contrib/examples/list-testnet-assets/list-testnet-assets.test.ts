import { describe, expect, it } from "vitest";
import { TESTNET_ASSETS } from "./list-testnet-assets";

describe("TESTNET_ASSETS", () => {
  it("lists at least 5 sample asset codes", () => {
    expect(TESTNET_ASSETS.length).toBeGreaterThanOrEqual(5);
  });

  it("gives every asset a non-empty code and description", () => {
    for (const asset of TESTNET_ASSETS) {
      expect(asset.code.length).toBeGreaterThan(0);
      expect(asset.description.length).toBeGreaterThan(0);
    }
  });

  it("includes the native XLM asset", () => {
    expect(TESTNET_ASSETS.some((a) => a.code === "XLM")).toBe(true);
  });

  it("has no duplicate asset codes", () => {
    const codes = TESTNET_ASSETS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
