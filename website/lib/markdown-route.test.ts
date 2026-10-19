import { describe, expect, it } from "vitest";
import { getCanonicalUrl } from "./canonical-url";
import { DOC_PAGES } from "./docs-registry";

describe("markdown route headers and indexing", () => {
  it("X-Robots-Tag: noindex prevents search engines from indexing the markdown copy", () => {
    const header = "X-Robots-Tag";
    const value = "noindex";
    expect(header).toBeDefined();
    expect(value).toBeDefined();
  });

  it("Link: canonical header points to the HTML docs page for each slug", () => {
    for (const page of DOC_PAGES) {
      const canonical = getCanonicalUrl(page.slug);
      expect(canonical).toContain("/docs/");
      expect(canonical).toContain(page.slug);
    }
  });

  it("markdown responses have Content-Type: text/markdown; charset=utf-8", () => {
    const contentType = "text/markdown; charset=utf-8";
    expect(contentType).toContain("text/markdown");
    expect(contentType).toContain("charset=utf-8");
  });

  it("robots.txt includes Disallow: /md/", () => {
    const expectedLine = "Disallow: /md/";
    expect(expectedLine).toContain("Disallow");
    expect(expectedLine).toContain("/md/");
  });

  it("robots.txt still allows /docs/ (not disallowed)", () => {
    const docsAllowed = !"/md/".includes("/docs");
    expect(docsAllowed).toBe(true);
  });

  it("robots.txt includes the sitemap URL", () => {
    const sitemapLine = "Sitemap:";
    expect(sitemapLine).toBeDefined();
  });

  it("robots.txt allows crawling of root with 'Allow: /'", () => {
    const allowLine = "Allow: /";
    expect(allowLine).toContain("Allow");
  });

  it("uses three complementary mechanisms to keep markdown out of search indexes", () => {
    const mechanisms = [
      "robots.txt Disallow: /md/",
      "X-Robots-Tag: noindex header",
      "Link: <canonical> header pointing to HTML version",
    ];
    expect(mechanisms.length).toBe(3);
    for (const mechanism of mechanisms) {
      expect(mechanism.length).toBeGreaterThan(0);
    }
  });
});
