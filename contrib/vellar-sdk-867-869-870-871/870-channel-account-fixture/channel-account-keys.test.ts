import { describe, expect, it } from "vitest";
import {
  CHANNEL_ACCOUNT_COUNT,
  generateChannelAccountSecrets,
} from "./channel-account-keys.mjs";
import { validateChannelAccountSecretKeys } from "./validator.js";

describe("CHANNEL_ACCOUNT_SECRET_KEYS fixture (#870)", () => {
  it("generates exactly 50 fresh keys that pass the format validator", () => {
    const value = generateChannelAccountSecrets();
    const parts = value.split(",");

    expect(parts).toHaveLength(CHANNEL_ACCOUNT_COUNT);
    expect(new Set(parts).size).toBe(CHANNEL_ACCOUNT_COUNT);
    expect(validateChannelAccountSecretKeys(value)).toEqual({ valid: true, errors: [] });
  });

  it("never reuses keys between runs", () => {
    const first = new Set(generateChannelAccountSecrets().split(","));
    const second = generateChannelAccountSecrets().split(",");

    expect(second.some((key) => first.has(key))).toBe(false);
  });

  it("refuses a count other than exactly 50", () => {
    expect(() => generateChannelAccountSecrets(49)).toThrow(/exactly 50 keys/);
    expect(() => generateChannelAccountSecrets(51)).toThrow(/exactly 50 keys/);
  });

  it("rejects empty input, wrong counts, invalid secrets, and duplicates", () => {
    expect(validateChannelAccountSecretKeys("").errors).toContain(
      "CHANNEL_ACCOUNT_SECRET_KEYS is empty",
    );
    expect(validateChannelAccountSecretKeys("S1,S2").errors[0]).toMatch(
      /expected exactly 50/,
    );

    const valid = generateChannelAccountSecrets().split(",");
    const withInvalid = [...valid];
    withInvalid[0] = "not-a-secret";
    expect(validateChannelAccountSecretKeys(withInvalid.join(",")).errors).toContain(
      "key 1 is not a valid Stellar classic secret",
    );

    const withDuplicate = [...valid];
    withDuplicate[1] = withDuplicate[0]!;
    expect(validateChannelAccountSecretKeys(withDuplicate.join(",")).errors).toContain(
      "key 2 duplicates an earlier key",
    );
  });
});
