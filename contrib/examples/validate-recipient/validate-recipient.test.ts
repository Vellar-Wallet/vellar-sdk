import { describe, expect, it } from "vitest";
import { validateRecipient } from "./validate-recipient";

const VALID_ACCOUNT = "GCFNFDLMAQB5J6LV65KG7GNAVGBREUVB2BWSLY6U46ACK4RDZG3SO3SH";
const VALID_CONTRACT = "CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG";
const BAD_CHECKSUM_ACCOUNT = "GCFNFDLMAQB5J6LV65KG7GNAVGBREUVB2BWSLY6U46ACK4RDZG3SO3SA";

describe("validateRecipient", () => {
  it("accepts a valid classic account address (G...)", () => {
    expect(validateRecipient(VALID_ACCOUNT)).toEqual({ valid: true });
  });

  it("accepts a valid contract address (C...)", () => {
    expect(validateRecipient(VALID_CONTRACT)).toEqual({ valid: true });
  });

  it("rejects a well-formed-looking address with a bad checksum", () => {
    const result = validateRecipient(BAD_CHECKSUM_ACCOUNT);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/checksum/);
  });

  it("rejects an address with an unexpected prefix", () => {
    const result = validateRecipient("XCFNFDLMAQB5J6LV65KG7GNAVGBREUVB2BWSLY6U46ACK4RDZG3SO3SH");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/must start with "G"/);
  });

  it("rejects an empty string", () => {
    const result = validateRecipient("");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("address is empty");
  });
});
