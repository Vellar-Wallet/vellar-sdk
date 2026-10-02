import { describe, it, expect } from "vitest";
import { sanitizeResourceMetadata } from "./x402-metadata-sanitization";

describe("Issue #261 — Untrusted x402 resource metadata sanitization", () => {
  it("sanitizes script injection attempts", () => {
    const raw = {
      name: "Resource <script>alert(1)</script>",
      description: "Description <img src=x onerror=alert(1)>",
    };
    const clean = sanitizeResourceMetadata(raw);
    expect(clean.name).toBe("Resource alert(1)");
    expect(clean.description).toBe("Description");
  });

  it("removes control characters and normalizes newlines", () => {
    const raw = {
      name: "Line 1\nLine 2",
      description: "Hidden\u202A Text", // U+202A is LTR override
    };
    const clean = sanitizeResourceMetadata(raw);
    expect(clean.name).toBe("Line 1 Line 2");
    expect(clean.description).toBe("Hidden Text");
  });

  it("clamps extremely long metadata", () => {
    const longText = "A".repeat(300);
    const raw = { name: longText };
    const clean = sanitizeResourceMetadata(raw);
    expect(clean.name?.length).toBe(256 + "…[clamped]".length);
    expect(clean.name?.endsWith("…[clamped]")).toBe(true);
  });
});
