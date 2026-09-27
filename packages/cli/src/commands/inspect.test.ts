import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("emits a JSON USAGE envelope for a malformed hash", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      makeInspectCommand().parseAsync(["node", "inspect", "not-a-hash", "--json"]),
    ).rejects.toThrow("exit:2");

    const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(printed.code).toBe("USAGE");
    expect(printed.retryable).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("emits a JSON NETWORK envelope when Horizon returns 404", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }),
    );

    await expect(
      makeInspectCommand().parseAsync([
        "node",
        "inspect",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "--json",
      ]),
    ).rejects.toThrow("exit:4");

    const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(printed.code).toBe("NETWORK");
    expect(printed.retryable).toBe(true);
    vi.unstubAllGlobals();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
