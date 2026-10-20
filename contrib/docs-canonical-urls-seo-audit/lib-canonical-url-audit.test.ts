/**
 * Per-page canonical URL audit tests.
 * COPY TO: website/lib/canonical-url-audit.test.ts
 * 
 * Verifies that every docs page has exactly one canonical URL and no duplicates.
 */

import { describe, expect, it } from "vitest";
import { getCanonicalUrl } from "./canonical-url";
import { DOC_PAGES, getDocPage } from "./docs-registry";

describe("canonical URL audit", () => {
  it("every docs page from the registry has a canonical URL", () => {
    for (const page of DOC_PAGES) {
      const canonical = getCanonicalUrl(page.slug);
      expect(canonical).toBeDefined();
      expect(canonical.length).toBeGreaterThan(0);
    }
  });

  it("every page's canonical URL contains its slug", () => {
    for (const page of DOC_PAGES) {
      const canonical = getCanonicalUrl(page.slug);
      const encodedSlug = page.slug
        .split("/")
        .map((s) => encodeURIComponent(s))
        .join("/");
      expect(canonical).toContain(encodedSlug);
    }
  });

  it("docs index page (/docs) has its own canonical", () => {
    expect(getCanonicalUrl("")).toBe("https://docs.vellar.xyz/docs");
  });

  it("no two pages share the same canonical URL", () => {
    const canonicals = DOC_PAGES.map((p) => getCanonicalUrl(p.slug));
    const uniqueCanonicals = new Set(canonicals);
    expect(uniqueCanonicals.size).toBe(canonicals.length);
  });

  it("canonical URL matches getDocPage().slug structure", () => {
    for (const page of DOC_PAGES) {
      const retrieved = getDocPage(page.slug);
      expect(retrieved).toBeDefined();
      expect(retrieved?.slug).toBe(page.slug);
      const canonical = getCanonicalUrl(retrieved!.slug);
      expect(canonical).toContain(page.slug);
    }
  });
});
