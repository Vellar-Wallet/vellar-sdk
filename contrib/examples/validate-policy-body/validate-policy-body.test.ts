import { describe, expect, it } from "vitest";
import { validatePolicyBody } from "./validate-policy-body";

describe("validatePolicyBody", () => {
  it("returns no errors for a valid body", () => {
    expect(validatePolicyBody({ limit: 100, windowSeconds: 86_400 })).toEqual([]);
  });

  it("returns every issue for a body with multiple problems, not just the first", () => {
    const errors = validatePolicyBody({ limit: -5, windowSeconds: 99_999_999 });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/limit must be a positive number/);
    expect(errors[1]).toMatch(/windowSeconds must be between/);
  });

  it("rejects a zero limit", () => {
    expect(validatePolicyBody({ limit: 0, windowSeconds: 86_400 })).toEqual([
      "limit must be a positive number, got 0",
    ]);
  });

  it("rejects a non-integer windowSeconds", () => {
    const errors = validatePolicyBody({ limit: 100, windowSeconds: 86_400.5 });
    expect(errors).toEqual(["windowSeconds must be an integer, got 86400.5"]);
  });

  it("rejects a windowSeconds below the minimum", () => {
    const errors = validatePolicyBody({ limit: 100, windowSeconds: 0 });
    expect(errors[0]).toMatch(/must be between 1 and/);
  });
});
