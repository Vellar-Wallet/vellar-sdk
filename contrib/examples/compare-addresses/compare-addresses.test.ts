import { describe, expect, it } from "vitest";
import { addressesEqual } from "./compare-addresses";

describe("addressesEqual", () => {
  it("returns true for identical addresses", () => {
    expect(addressesEqual("GABC123DEF456", "GABC123DEF456")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(addressesEqual("GABC123DEF456", "gabc123def456")).toBe(true);
  });

  it("returns false for different addresses", () => {
    expect(addressesEqual("GABC123DEF456", "GDIFFERENT789")).toBe(false);
  });

  it("returns false rather than throwing when either input is null", () => {
    expect(addressesEqual(null, "GABC123DEF456")).toBe(false);
    expect(addressesEqual("GABC123DEF456", null)).toBe(false);
  });

  it("returns false rather than throwing when either input is undefined", () => {
    expect(addressesEqual(undefined, "GABC123DEF456")).toBe(false);
    expect(addressesEqual(undefined, undefined)).toBe(false);
  });
});
