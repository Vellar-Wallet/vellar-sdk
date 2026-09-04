import { describe, expect, it } from "vitest";
import { checkContractId } from "./check-contract-id";

const VALID_CONTRACT_ID = "CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG";
const BAD_CHECKSUM_CONTRACT_ID = "CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZA";

describe("checkContractId", () => {
  it("accepts a well-formed contract id", () => {
    expect(checkContractId(VALID_CONTRACT_ID)).toEqual({ valid: true });
  });

  it("rejects a string not starting with C", () => {
    const result = checkContractId("GDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/must start with "C"/);
  });

  it("rejects a string of the wrong length", () => {
    const result = checkContractId("CTOOSHORT");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/must be 56 characters/);
  });

  it("rejects a well-formed-looking string with a bad checksum", () => {
    const result = checkContractId(BAD_CHECKSUM_CONTRACT_ID);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/checksum/);
  });
});
