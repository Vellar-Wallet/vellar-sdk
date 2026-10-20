/**
 * Unit tests for canonical URL helper.
 * COPY TO: website/lib/canonical-url.test.ts
 */

import { describe, expect, it } from "vitest";
import { CANONICAL_ORIGIN, getCanonicalUrl } from "./canonical-url";

describe("getCanonicalUrl", () => {
  it("returns /docs for an empty slug (docs index)", () => {
    expect(getCanonicalUrl("")).toBe(`${CANONICAL_ORIGIN}/docs`);
  });

  it("returns /docs/<slug> for a single-segment slug", () => {
    expect(getCanonicalUrl("x402")).toBe(`${CANONICAL_ORIGIN}/docs/x402`);
  });

  it("returns /docs/<slug1>/<slug2> for a nested slug", () => {
    expect(getCanonicalUrl("getting-started/quickstart")).toBe(
      `${CANONICAL_ORIGIN}/docs/getting-started/quickstart`,
    );
  });

  it("URL-encodes special characters in slug segments", () => {
    expect(getCanonicalUrl("hello world")).toBe(
      `${CANONICAL_ORIGIN}/docs/hello%20world`,
    );
  });

  it("does not encode hyphens and numbers (valid slug characters)", () => {
    expect(getCanonicalUrl("x402-v1-2")).toBe(`${CANONICAL_ORIGIN}/docs/x402-v1-2`);
  });

  it("never includes a trailing slash", () => {
    expect(getCanonicalUrl("test").endsWith("/")).toBe(false);
  });

  it("never includes a query string or fragment", () => {
    const url = getCanonicalUrl("test");
    expect(url).not.toContain("?");
    expect(url).not.toContain("#");
  });

  it("exports the canonical origin", () => {
    expect(CANONICAL_ORIGIN).toBe("https://docs.vellar.xyz");
  });
});
