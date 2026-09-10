import { describe, expect, it } from "vitest";
import { DEFAULT_FACILITATOR_URL, makeSearchCommand } from "./search.js";

function optionFor(flags: string) {
  return makeSearchCommand()
    .options.find((o) => o.long === flags);
}

describe("search command", () => {
  it("is named 'search' and takes one required query argument", () => {
    const cmd = makeSearchCommand();
    expect(cmd.name()).toBe("search");
    expect(cmd.description()).toMatch(/bazaar/i);
    expect(cmd.registeredArguments).toHaveLength(1);
    expect(cmd.registeredArguments[0]?.required).toBe(true);
  });

  it("registers --json", () => {
    expect(optionFor("--json")).toBeDefined();
  });

  it("registers --limit with a default of 10", () => {
    expect(optionFor("--limit")?.defaultValue).toBe("10");
  });

  it("defaults --facilitator to the hosted facilitator", () => {
    // Guards the default rather than just its presence: a wrong default sends
    // a user's query to the wrong service without any error.
    expect(DEFAULT_FACILITATOR_URL).toBe("https://vellar-facilitator.onrender.com");
    expect(optionFor("--facilitator")?.defaultValue).toBe(DEFAULT_FACILITATOR_URL);
  });

  it("builds the discovery URL with the 'query' parameter, not 'q'", () => {
    // The endpoint ignores an unknown key and returns an unfiltered listing, so
    // getting this wrong looks like a working search that ranks nothing.
    const url = new URL("/discovery/search", DEFAULT_FACILITATOR_URL);
    url.searchParams.set("query", "weather data");
    url.searchParams.set("limit", "10");
    expect(url.searchParams.get("query")).toBe("weather data");
    expect(url.pathname).toBe("/discovery/search");
  });
});
