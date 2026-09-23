import { describe, expect, it } from "vitest";
import { HORIZON_URLS, makeInspectCommand } from "./inspect.js";

function optionFor(flags: string) {
  return makeInspectCommand().options.find((o) => o.long === flags);
}

describe("inspect command", () => {
  it("is named 'inspect' and takes one required hash argument", () => {
    const cmd = makeInspectCommand();
    expect(cmd.name()).toBe("inspect");
    expect(cmd.registeredArguments).toHaveLength(1);
    expect(cmd.registeredArguments[0]?.required).toBe(true);
  });

  it("defaults --network to testnet", () => {
    // Vellar runs on testnet only, so a mainnet default would send every
    // lookup to a Horizon where none of these hashes exist.
    expect(optionFor("--network")?.defaultValue).toBe("testnet");
  });

  it("registers --json", () => {
    expect(optionFor("--json")).toBeDefined();
  });

  it("maps both networks to distinct Horizon hosts", () => {
    expect(HORIZON_URLS.testnet).toBe("https://horizon-testnet.stellar.org");
    expect(HORIZON_URLS.mainnet).toBe("https://horizon.stellar.org");
    expect(HORIZON_URLS.testnet).not.toBe(HORIZON_URLS.mainnet);
  });

  it("has no Horizon URL for an unknown network", () => {
    // The command branches on this being undefined to refuse before fetching.
    expect(HORIZON_URLS.pubnet).toBeUndefined();
  });
});
