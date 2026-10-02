import { describe, it, expect } from "vitest";
import { sanitizeErrorSecrets } from "./secrets-sanitization-backend";

describe("Issue #256 — Secrets Sanitization", () => {
  it("redacts sensitive tokens, bearer headers, and passwords", () => {
    const raw = "Failed with Bearer eyJhbGciOiJIUzI1NiJ9.test and sk_live_9837492837492834";
    const sanitized = sanitizeErrorSecrets(raw);

    expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(sanitized).not.toContain("sk_live_9837492837492834");
    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).toContain("[REDACTED_SECRET_KEY]");
  });
});
