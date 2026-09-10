import { describe, expect, it } from "vitest";
import { decodeChallenge, makeQuoteCommand } from "./quote.js";

const CHALLENGE = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "1000000",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      payTo: "GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC",
      extra: { areFeesSponsored: true },
    },
  ],
};

describe("quote command", () => {
  it("is named 'quote' and takes one required url argument", () => {
    const cmd = makeQuoteCommand();
    expect(cmd.name()).toBe("quote");
    expect(cmd.registeredArguments).toHaveLength(1);
    expect(cmd.registeredArguments[0]?.required).toBe(true);
  });

  it("registers --json", () => {
    expect(makeQuoteCommand().options.find((o) => o.long === "--json")).toBeDefined();
  });
});

describe("decodeChallenge", () => {
  it("decodes a base64 PAYMENT-REQUIRED header", () => {
    const header = Buffer.from(JSON.stringify(CHALLENGE), "utf8").toString("base64");
    expect(decodeChallenge(header, "")?.accepts?.[0]?.amount).toBe("1000000");
  });

  it("accepts an unencoded JSON header", () => {
    expect(decodeChallenge(JSON.stringify(CHALLENGE), "")?.accepts).toHaveLength(1);
  });

  it("falls back to the body when the header is absent", () => {
    expect(decodeChallenge(null, JSON.stringify(CHALLENGE))?.accepts?.[0]?.scheme).toBe("exact");
  });

  it("prefers the header over the body", () => {
    const header = Buffer.from(JSON.stringify(CHALLENGE), "utf8").toString("base64");
    const body = JSON.stringify({ accepts: [{ scheme: "upto", amount: "999" }] });
    expect(decodeChallenge(header, body)?.accepts?.[0]?.scheme).toBe("exact");
  });

  it("returns null when neither source parses, rather than an empty challenge", () => {
    // Null is what makes the caller report an undecodable 402. An empty object
    // would read as "no payment options" and hide the real failure.
    expect(decodeChallenge("not-base64-or-json", "also not json")).toBeNull();
    expect(decodeChallenge(null, "")).toBeNull();
  });
});
