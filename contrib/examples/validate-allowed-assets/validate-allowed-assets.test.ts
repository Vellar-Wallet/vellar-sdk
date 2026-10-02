import { describe, expect, it } from "vitest";
import { validateAllowedAssets } from "./validate-allowed-assets";

const VALID_CONTRACT = "CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG";

describe("validateAllowedAssets", () => {
  it("accepts an empty allow-list", () => {
    expect(validateAllowedAssets([])).toEqual([]);
  });

  it("reports every malformed contract id", () => {
    expect(validateAllowedAssets([VALID_CONTRACT, "GACCOUNT", "CTOOSHORT"])).toEqual([
      { asset: "GACCOUNT", reason: "must start with C" },
      { asset: "CTOOSHORT", reason: "must be 56 characters" },
    ]);
  });
});