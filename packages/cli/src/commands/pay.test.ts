import { afterEach, describe, expect, it, vi } from "vitest";
import { makePayCommand, selectRequirement } from "./pay.js";
import type { Requirement } from "./quote.js";

function optionFor(flags: string) {
  return makePayCommand().options.find((o) => o.long === flags);
}

const sponsored = { areFeesSponsored: true };

function req(over: Partial<Requirement> = {}): Requirement {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    amount: "1000000",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    payTo: "GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC",
    extra: sponsored,
    ...over,
  } as Requirement;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VELLAR_SECRET;
});

describe("pay command", () => {
  it("is named 'pay' and takes one required url argument", () => {
    const cmd = makePayCommand();
    expect(cmd.name()).toBe("pay");
    expect(cmd.registeredArguments).toHaveLength(1);
    expect(cmd.registeredArguments[0]?.required).toBe(true);
  });

  it("defaults --max to 1000000 base units", () => {
    expect(optionFor("--max")?.defaultValue).toBe("1000000");
  });

  it("registers --secret and --secret-file", () => {
    expect(optionFor("--secret")).toBeDefined();
    expect(optionFor("--secret-file")).toBeDefined();
  });

  it("registers --json and --network", () => {
    expect(optionFor("--json")).toBeDefined();
    expect(optionFor("--network")?.defaultValue).toBe("testnet");
  });

  it("exits with an error when no secret is supplied", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // process.exit is stubbed to throw so the action stops where the real one
    // would, instead of running on into a network call during the test.
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(
      makePayCommand().parseAsync(["node", "pay", "https://example.test/paid"]),
    ).rejects.toThrow("exit:1");

    expect(exit).toHaveBeenCalledWith(1);
    expect(err.mock.calls.flat().join(" ")).toMatch(/--secret-file/);
  });
});

describe("selectRequirement", () => {
  it("picks the exact requirement on the requested network", () => {
    const { chosen } = selectRequirement([req()], "stellar:testnet");
    expect(chosen?.scheme).toBe("exact");
  });

  it("picks the cheapest exact option rather than the first listed", () => {
    // A seller listing the dearest option first should not be paid the most
    // simply because of array order.
    const { chosen } = selectRequirement(
      [req({ amount: "5000000" }), req({ amount: "1000000" })],
      "stellar:testnet",
    );
    expect(chosen?.amount).toBe("1000000");
  });

  it("refuses when the seller offers no option on the requested network", () => {
    const { chosen, reason } = selectRequirement([req()], "stellar:pubnet");
    expect(chosen).toBeUndefined();
    expect(reason).toMatch(/no payment option/);
  });

  it("refuses an upto-only seller and names the scheme offered", () => {
    // upto needs a contract call this classic-keypair path does not build, so
    // it must be reported rather than half-attempted.
    const { chosen, reason } = selectRequirement(
      [req({ scheme: "upto" })],
      "stellar:testnet",
    );
    expect(chosen).toBeUndefined();
    expect(reason).toMatch(/upto/);
  });
});
