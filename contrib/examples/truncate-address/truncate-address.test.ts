import { describe, expect, it } from "vitest";
import { truncateAddress } from "./truncate-address";

describe("truncateAddress", () => {
  it("shortens a long address to first 6 + last 4 characters", () => {
    expect(truncateAddress("CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG")).toBe(
      "CDFDUL...MVZG",
    );
  });

  it("returns an address exactly at the head+tail length unchanged", () => {
    expect(truncateAddress("1234567890")).toBe("1234567890"); // 10 chars = 6 + 4
  });

  it("returns a shorter address unchanged", () => {
    expect(truncateAddress("GSHORT")).toBe("GSHORT");
  });

  it("supports custom head/tail lengths", () => {
    expect(truncateAddress("ABCDEFGHIJKLMNOP", 3, 2)).toBe("ABC...OP");
  });
});
