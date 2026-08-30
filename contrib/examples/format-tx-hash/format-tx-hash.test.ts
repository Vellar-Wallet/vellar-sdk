import { describe, expect, it } from "vitest";
import { formatTxHash } from "./format-tx-hash";

describe("formatTxHash", () => {
  it("shortens a long hash to first 6 + last 4 characters", () => {
    const hash = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
    expect(formatTxHash(hash)).toBe("a1b2c3...a1b2");
  });

  it("returns a hash exactly at the head+tail length unchanged", () => {
    expect(formatTxHash("1234567890")).toBe("1234567890"); // 10 chars = 6 + 4
  });

  it("returns a shorter hash unchanged without throwing", () => {
    expect(formatTxHash("abc")).toBe("abc");
    expect(formatTxHash("")).toBe("");
  });

  it("supports custom head/tail lengths", () => {
    expect(formatTxHash("abcdefghijklmnop", 3, 2)).toBe("abc...op");
  });
});
