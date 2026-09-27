import { afterEach, describe, expect, it, vi } from "vitest";
import { makePayCommand, safeJsonParse, selectRequirement } from "./pay.js";
import type { Requirement } from "./quote.js";

function optionFor(flags: string) {
  return makePayCommand().options.find((o) => o.long === flags);
}

// A throwaway keypair generated solely for these tests (never funded, never
// used anywhere else) — just needs to pass Keypair.fromSecret's format check
// so the action gets past secret parsing and on to the code under test.
const FAKE_SECRET = "SDABELWZ4DABVQRAO2IH6GXLHIJADWG7ZEXRWBBV5JRJBZMSGYU5IQ33";

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

  it("defaults --max to 10000000 base units", () => {
    // Must comfortably clear lifecycle/execute's 5000000 base units (0.50
    // USDC) without the caller having to know that price in advance.
    expect(optionFor("--max")?.defaultValue).toBe("10000000");
  });

  it("registers --secret and --secret-file", () => {
    expect(optionFor("--secret")).toBeDefined();
    expect(optionFor("--secret-file")).toBeDefined();
  });

  it("registers --json and --network", () => {
    expect(optionFor("--json")).toBeDefined();
    expect(optionFor("--network")?.defaultValue).toBe("testnet");
  });

  it("defaults --method to GET", () => {
    expect(optionFor("--method")?.defaultValue).toBe("GET");
  });

  it("registers --body with no default (so it can be told apart from an explicit '{}')", () => {
    expect(optionFor("--body")).toBeDefined();
    expect(optionFor("--body")?.defaultValue).toBeUndefined();
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
    ).rejects.toThrow("exit:2");

    expect(exit).toHaveBeenCalledWith(2);
    expect(err.mock.calls.flat().join(" ")).toMatch(/--secret-file/);
  });

  it("rejects a --method outside GET/POST/PUT/PATCH/DELETE before making any network call", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      makePayCommand().parseAsync([
        "node",
        "pay",
        "https://example.test/paid",
        "--secret",
        FAKE_SECRET,
        "--method",
        "TRACE",
      ]),
    ).rejects.toThrow("exit:2");

    expect(exit).toHaveBeenCalledWith(2);
    expect(err.mock.calls.flat().join(" ")).toMatch(/--method must be one of/);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("accepts --method in any case and normalises it to uppercase", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "boom" });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(
      makePayCommand().parseAsync([
        "node",
        "pay",
        "https://example.test/paid",
        "--secret",
        FAKE_SECRET,
        "--method",
        "delete",
      ]),
    ).rejects.toThrow("exit:4");

    const [, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledInit.method).toBe("DELETE");

    vi.unstubAllGlobals();
  });

  it("rejects invalid --body JSON before making any network call", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      makePayCommand().parseAsync([
        "node",
        "pay",
        "https://example.test/paid",
        "--secret",
        FAKE_SECRET,
        "--method",
        "POST",
        "--body",
        "{not valid json",
      ]),
    ).rejects.toThrow("exit:2");

    expect(exit).toHaveBeenCalledWith(2);
    expect(err.mock.calls.flat().join(" ")).toMatch(/--body must be valid JSON/);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("probes with the method given by --method, not a hardcoded GET", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "boom",
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(
      makePayCommand().parseAsync([
        "node",
        "pay",
        "https://example.test/lifecycle/execute",
        "--secret",
        FAKE_SECRET,
        "--method",
        "post",
        "--body",
        '{"accountId":"G..."}',
      ]),
    ).rejects.toThrow("exit:4");

    // Only the probe fires on this path (a non-402 status returns before any
    // payment is built), so this is unambiguously the probe request.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://example.test/lifecycle/execute");
    // --method is uppercased regardless of the case it was typed in.
    expect(calledInit.method).toBe("POST");
    expect(calledInit.body).toBe('{"accountId":"G..."}');
    expect((calledInit.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    vi.unstubAllGlobals();
  });

  it("never attaches a body to the GET probe, even with the default method", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "boom" });
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(
      makePayCommand().parseAsync([
        "node",
        "pay",
        "https://example.test/quote",
        "--secret",
        FAKE_SECRET,
      ]),
    ).rejects.toThrow("exit:4");

    const [, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledInit.method).toBe("GET");
    expect(calledInit.body).toBeUndefined();
    expect(calledInit.headers).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it("emits a JSON USAGE envelope on --json when no secret is supplied", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(
      makePayCommand().parseAsync(["node", "pay", "https://example.test/paid", "--json"]),
    ).rejects.toThrow("exit:2");

    const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(printed.code).toBe("USAGE");
    expect(printed.retryable).toBe(false);
    expect(printed.message).toMatch(/secret/);
    expect(printed).not.toHaveProperty("stack");
    expect(exit).toHaveBeenCalledWith(2);
  });

  it("emits a JSON REFUSED envelope when the price exceeds --max", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const challenge = {
      x402Version: 2,
      accepts: [req({ amount: "9999999999" })],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      statusText: "Payment Required",
      headers: { get: (n: string) => (n.toLowerCase() === "payment-required" ? Buffer.from(JSON.stringify(challenge)).toString("base64") : null) },
      text: async () => "",
    }));

    await expect(
      makePayCommand().parseAsync([
        "node",
        "pay",
        "https://example.test/paid",
        "--secret",
        FAKE_SECRET,
        "--max",
        "1",
        "--json",
      ]),
    ).rejects.toThrow("exit:3");

    const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(printed.code).toBe("REFUSED");
    expect(printed.retryable).toBe(false);
    expect(printed.message).toMatch(/exceeds --max/);
    vi.unstubAllGlobals();
  });

  it("emits a JSON NETWORK envelope on an unexpected probe status", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "boom" }));

    await expect(
      makePayCommand().parseAsync([
        "node",
        "pay",
        "https://example.test/paid",
        "--secret",
        FAKE_SECRET,
        "--json",
      ]),
    ).rejects.toThrow("exit:4");

    const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(printed.code).toBe("NETWORK");
    expect(printed.retryable).toBe(true);
    vi.unstubAllGlobals();
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

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null for non-JSON text rather than throwing", () => {
    expect(safeJsonParse("not json")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(safeJsonParse("")).toBeNull();
  });
});
