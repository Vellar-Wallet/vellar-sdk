import { describe, expect, it } from "vitest";
import { probeCatalogDurability } from "./durability.js";

describe("probeCatalogDurability (#873)", () => {
  it("is inconclusive when no resource has a persisted statsSource", () => {
    const result = probeCatalogDurability([]);

    expect(result.verdict).toBe("inconclusive");
    expect(result.evidenceIndex).toBeUndefined();
    expect(result.reason).toContain("not a direct read of CATALOG_DB_URL");
    expect(result.reason).toContain("inconclusive rather than false");
  });

  it("stays inconclusive when resources only report an observed statsSource", () => {
    const result = probeCatalogDurability([
      { trust: { statsSource: "observed" } },
      { trust: { statsSource: "observed" } },
    ]);

    expect(result.verdict).toBe("inconclusive");
  });

  it("stays inconclusive when trust metadata is absent", () => {
    expect(probeCatalogDurability([{}, { trust: {} }]).verdict).toBe("inconclusive");
  });

  it("reports durable on the first persisted statsSource", () => {
    const result = probeCatalogDurability([
      { trust: { statsSource: "observed" } },
      { trust: { statsSource: "persisted" } },
      { trust: { statsSource: "persisted" } },
    ]);

    expect(result.verdict).toBe("durable");
    expect(result.evidenceIndex).toBe(1);
    expect(result.reason).toContain("inference from observed behavior");
  });

  it("accepts a top-level statsSource field as well as a nested trust field", () => {
    expect(probeCatalogDurability([{ statsSource: "persisted" }]).verdict).toBe("durable");
  });

  it("never returns a negative verdict", () => {
    for (const resources of [[], [{ trust: { statsSource: "observed" } }]]) {
      const verdict = probeCatalogDurability(resources).verdict;
      expect(["durable", "inconclusive"]).toContain(verdict);
    }
  });
});
