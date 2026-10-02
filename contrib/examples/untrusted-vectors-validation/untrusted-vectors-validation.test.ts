import { describe, it, expect } from "vitest";
import { validateUntrustedPayload } from "./untrusted-vectors-validation";

describe("Issue #255 — Untrusted Vectors Validation", () => {
  it("validates safe payloads and rejects malicious payloads", () => {
    expect(validateUntrustedPayload({ nonce: "0123456789abcdef", body: "Safe description" }).isValid).toBe(true);

    expect(validateUntrustedPayload({ nonce: "short", body: "Safe" }).isValid).toBe(false);

    expect(
      validateUntrustedPayload({
        nonce: "0123456789abcdef",
        body: "Hostile \u202Ereversed text",
      }).isValid
    ).toBe(false);
  });
});
