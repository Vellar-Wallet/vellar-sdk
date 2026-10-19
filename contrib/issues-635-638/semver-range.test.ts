import { describe, expect, it } from "vitest";
import { pickBounds, satisfies } from "./semver-range.mjs";
import { resolveCompatVersions } from "./resolve-compat-versions.mjs";

describe("satisfies", () => {
  it("handles caret ranges", () => {
    expect(satisfies("16.0.0", "^16.0.0")).toBe(true);
    expect(satisfies("16.3.1", "^16.0.0")).toBe(true);
    expect(satisfies("17.0.0", "^16.0.0")).toBe(false);
    expect(satisfies("15.9.9", "^16.0.0")).toBe(false);
  });

  it("handles 0.x caret ranges narrowly", () => {
    expect(satisfies("0.2.5", "^0.2.3")).toBe(true);
    expect(satisfies("0.3.0", "^0.2.3")).toBe(false);
  });

  it("handles space-joined comparator ranges", () => {
    expect(satisfies("0.13.1", ">=0.13.0 <0.17.0")).toBe(true);
    expect(satisfies("0.16.5", ">=0.13.0 <0.17.0")).toBe(true);
    expect(satisfies("0.17.0", ">=0.13.0 <0.17.0")).toBe(false);
    expect(satisfies("0.12.1", ">=0.13.0 <0.17.0")).toBe(false);
  });

  it("handles tilde and OR ranges", () => {
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfies("2.0.0", "^1.0.0 || ^2.0.0")).toBe(true);
  });

  it("rejects prereleases and garbage versions", () => {
    expect(satisfies("16.1.0-beta.1", "^16.0.0")).toBe(false);
    expect(satisfies("not-a-version", "^16.0.0")).toBe(false);
  });

  it("throws on unsupported range tokens", () => {
    expect(() => satisfies("1.0.0", "^1.0.0-beta")).toThrow(/Unsupported range token/);
  });
});

describe("pickBounds / resolveCompatVersions", () => {
  const published = ["0.12.1", "0.13.1", "0.14.0", "0.16.5", "0.17.0", "0.19.1"];

  it("returns the lowest and highest in-range versions", () => {
    expect(pickBounds(published, ">=0.13.0 <0.17.0")).toEqual({ floor: "0.13.1", latest: "0.16.5" });
  });

  it("sorts numerically, not lexically", () => {
    expect(pickBounds(["16.2.0", "16.10.0", "16.9.0"], "^16.0.0")).toEqual({
      floor: "16.2.0",
      latest: "16.10.0",
    });
  });

  it("returns null when nothing matches", () => {
    expect(pickBounds(["1.0.0"], "^2.0.0")).toBeNull();
  });

  it("resolveCompatVersions fails loudly when the range matches nothing", () => {
    expect(() => resolveCompatVersions("x", "^2.0.0", ["1.0.0"])).toThrow(/No published version of x/);
    expect(resolveCompatVersions("x", "^1.0.0", ["1.0.0", "1.4.0"])).toEqual({
      name: "x",
      range: "^1.0.0",
      floor: "1.0.0",
      latest: "1.4.0",
    });
  });
});
