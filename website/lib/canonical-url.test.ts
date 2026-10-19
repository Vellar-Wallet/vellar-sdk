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

  it("handles deeply nested slugs", () => {
    expect(getCanonicalUrl("a/b/c/d")).toBe(`${CANONICAL_ORIGIN}/docs/a/b/c/d`);
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
    const url = getCanonicalUrl("test");
    expect(url.endsWith("/")).toBe(false);
  });

  it("includes only the origin and path, never a query string", () => {
    const url = getCanonicalUrl("test");
    expect(url).not.toContain("?");
  });

  it("includes only the origin and path, never a fragment", () => {
    const url = getCanonicalUrl("test");
    expect(url).not.toContain("#");
  });

  it("uses the configured origin", () => {
    const url = getCanonicalUrl("x402");
    expect(url).toContain("docs.vellar.xyz");
    expect(url).toMatch(/^https:\/\//);
  });

  it("works for known registry pages", () => {
    const examples = [
      { slug: "getting-started/introduction", expected: "https://docs.vellar.xyz/docs/getting-started/introduction" },
      { slug: "x402", expected: "https://docs.vellar.xyz/docs/x402" },
    ];
    for (const { slug, expected } of examples) {
      expect(getCanonicalUrl(slug)).toBe(expected);
    }
  });

  it("exports the canonical origin for use in metadata setup", () => {
    expect(CANONICAL_ORIGIN).toBe("https://docs.vellar.xyz");
  });
});
