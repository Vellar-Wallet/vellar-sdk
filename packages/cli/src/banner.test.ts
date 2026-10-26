import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printStartupBanner, resolveOption } from "./banner.js";

function makeRootAndAction(opts: { quiet?: boolean } = {}) {
  const root = new Command("vellar");
  if (opts.quiet) {
    root.option("--quiet", "desc");
  }

  const action = new Command("inspect")
    .option("--network <network>", "desc", process.env.VELLAR_NETWORK ?? "testnet")
    .option("--facilitator <url>", "desc", process.env.VELLAR_FACILITATOR_URL ?? "https://default.example");
  root.addCommand(action);

  return { root, action };
}

afterEach(() => {
  delete process.env.VELLAR_NETWORK;
  delete process.env.VELLAR_FACILITATOR_URL;
  vi.restoreAllMocks();
});

describe("resolveOption", () => {
  it("reports 'flag' when the value came from an explicit CLI flag", () => {
    const { action } = makeRootAndAction();
    action.parse(["node", "inspect", "--network", "mainnet"]);

    const resolved = resolveOption(action, "network", "VELLAR_NETWORK");
    expect(resolved).toEqual({
      name: "network",
      value: "mainnet",
      source: "flag",
      envVar: "VELLAR_NETWORK",
    });
  });

  it("reports 'env' when the default read an environment variable and no flag was passed", () => {
    process.env.VELLAR_NETWORK = "mainnet";
    const { action } = makeRootAndAction();
    action.parse(["node", "inspect"]);

    const resolved = resolveOption(action, "network", "VELLAR_NETWORK");
    expect(resolved).toEqual({
      name: "network",
      value: "mainnet",
      source: "env",
      envVar: "VELLAR_NETWORK",
    });
  });

  it("reports 'default' when neither a flag nor the environment variable was set", () => {
    const { action } = makeRootAndAction();
    action.parse(["node", "inspect"]);

    const resolved = resolveOption(action, "network", "VELLAR_NETWORK");
    expect(resolved).toEqual({
      name: "network",
      value: "testnet",
      source: "default",
      envVar: "VELLAR_NETWORK",
    });
  });

  it("returns undefined when the command does not define the option at all", () => {
    const quote = new Command("quote").option("--json", "desc");
    quote.parse(["node", "quote"]);

    expect(resolveOption(quote, "network", "VELLAR_NETWORK")).toBeUndefined();
  });

  it("a CLI flag takes precedence over an environment variable", () => {
    process.env.VELLAR_NETWORK = "mainnet";
    const { action } = makeRootAndAction();
    action.parse(["node", "inspect", "--network", "testnet"]);

    const resolved = resolveOption(action, "network", "VELLAR_NETWORK");
    expect(resolved?.source).toBe("flag");
    expect(resolved?.value).toBe("testnet");
  });
});

describe("printStartupBanner", () => {
  it("prints one line naming every resolved option this command defines", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, action } = makeRootAndAction();
    action.parse(["node", "inspect", "--network", "mainnet"]);

    printStartupBanner(root, action);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("inspect");
    expect(line).toContain("network=mainnet (flag)");
    expect(line).toContain("facilitator=https://default.example (default)");
  });

  it("prints nothing when the root --quiet flag was passed", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, action } = makeRootAndAction({ quiet: true });
    root.parse(["node", "vellar", "--quiet", "inspect"]);
    action.parse(["node", "inspect"]);

    printStartupBanner(root, action);

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("prints nothing for a command that defines neither --network nor --facilitator", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = new Command("vellar");
    const quote = new Command("quote").option("--json", "desc");
    root.addCommand(quote);
    quote.parse(["node", "quote"]);

    printStartupBanner(root, quote);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
