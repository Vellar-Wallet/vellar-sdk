import { describe, expect, it } from "vitest";
import {
  assertUptoRequirement,
  decodeUptoSettlement,
  UptoSettlementQueue,
  type UptoRequirements,
} from "./upto-buyer";

const CONTRACT = "CCZL7CTRS6GWEYXDYD54DZM3OUHQW2S2A4KSU75SH275P3SFZLL4YQAN";

function requirement(overrides: Partial<UptoRequirements> = {}): UptoRequirements {
  return {
    scheme: "upto",
    network: "stellar:testnet",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    amount: "500000",
    payTo: "GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC",
    maxTimeoutSeconds: 120,
    extra: { areFeesSponsored: true, uptoContract: CONTRACT },
    ...overrides,
  };
}

function responseFor(result: unknown): Response {
  const json = JSON.stringify(result);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return new Response(null, { headers: { "X-PAYMENT-RESPONSE": btoa(binary) } });
}

describe("upto requirement and reported settlement", () => {
  it("accepts the configured contract and returns the ceiling", () => {
    expect(assertUptoRequirement(requirement(), 600000n, CONTRACT)).toBe(500000n);
  });

  it("rejects unknown scheme, unsponsored fees, untrusted contract, and over-ceiling options", () => {
    expect(() => assertUptoRequirement(requirement({ scheme: "exact" }), 600000n, CONTRACT)).toThrow(/scheme/);
    expect(() => assertUptoRequirement(requirement({ extra: { uptoContract: CONTRACT } }), 600000n, CONTRACT)).toThrow(/sponsorship/);
    expect(() => assertUptoRequirement(requirement({ extra: { areFeesSponsored: true, uptoContract: "COTHER" } }), 600000n, CONTRACT)).toThrow(/trusted contract/);
    expect(() => assertUptoRequirement(requirement(), 400000n, CONTRACT)).toThrow(/exceeds maxAmount/);
    expect(() => assertUptoRequirement(requirement({ amount: "1e5" }), 600000n, CONTRACT)).toThrow(/integer/);
  });

  it("surfaces actual settlement separately from the signed ceiling", () => {
    const decoded = decodeUptoSettlement(
      responseFor({ success: true, transaction: "a".repeat(64), amount: "100000" }),
      500000n,
    );
    expect(decoded).toEqual({
      transaction: "a".repeat(64),
      ceiling: 500000n,
      settledAmount: 100000n,
    });
  });

  it("does not return an amount-less or failed settlement as paid", () => {
    expect(decodeUptoSettlement(responseFor({ success: true, transaction: "a".repeat(64) }), 500000n)).toBeUndefined();
    expect(decodeUptoSettlement(responseFor({ success: false, transaction: "", amount: "0" }), 500000n)).toBeUndefined();
  });

  it("rejects a facilitator-reported amount above the signed ceiling", () => {
    expect(() => decodeUptoSettlement(
      responseFor({ success: true, transaction: "a".repeat(64), amount: "500001" }),
      500000n,
    )).toThrow(/exceeds the buyer-authorized ceiling/);
  });
});

describe("upto settlement serialization", () => {
  it("runs concurrent settlements one at a time and continues after rejection", async () => {
    const queue = new UptoSettlementQueue();
    const running: string[] = [];
    const settled: string[] = [];
    const task = (id: string, fail = false) => queue.run(async () => {
      running.push(id);
      expect(running).toHaveLength(1);
      await Promise.resolve();
      running.pop();
      settled.push(id);
      if (fail) throw new Error("txBadSeq");
      return id;
    });

    const first = task("first");
    const second = task("second", true);
    const third = task("third");
    await expect(first).resolves.toBe("first");
    await expect(second).rejects.toThrow("txBadSeq");
    await expect(third).resolves.toBe("third");
    expect(settled).toEqual(["first", "second", "third"]);
  });
});