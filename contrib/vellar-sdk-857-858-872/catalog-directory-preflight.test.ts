import { describe, expect, it } from "vitest";
import { checkCatalogDataDirectory } from "./catalog-directory-preflight.js";

describe("local facilitator catalog-directory preflight (#872)", () => {
  it("reports a missing data directory before facilitator startup", () => {
    const result = checkCatalogDataDirectory("data", () => false);

    expect(result.ready).toBe(false);
    expect(result.message).toContain("mkdir -p data");
  });

  it("allows startup when the setup fixture has created the directory", () => {
    expect(checkCatalogDataDirectory("data", () => true).ready).toBe(true);
  });
});
