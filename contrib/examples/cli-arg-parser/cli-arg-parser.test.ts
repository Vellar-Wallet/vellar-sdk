import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli-arg-parser";

describe("parseArgs", () => {
  it("parses a --key=value flag", () => {
    expect(parseArgs(["--network=testnet"])).toEqual({
      flags: { network: "testnet" },
      positionals: [],
    });
  });

  it("parses a bare flag as boolean true", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ flags: { "dry-run": true }, positionals: [] });
  });

  it("collects non-flag tokens as positionals", () => {
    expect(parseArgs(["one", "two"])).toEqual({ flags: {}, positionals: ["one", "two"] });
  });

  it("parses a mix of flags and positionals in one call", () => {
    const result = parseArgs(["--network=testnet", "--dry-run", "positional1", "--amount=100", "positional2"]);
    expect(result).toEqual({
      flags: { network: "testnet", "dry-run": true, amount: "100" },
      positionals: ["positional1", "positional2"],
    });
  });

  it("returns empty flags and positionals for an empty input", () => {
    expect(parseArgs([])).toEqual({ flags: {}, positionals: [] });
  });
});
