import { describe, expect, it, beforeAll } from "vitest";
import { REDIRECTS, type Redirect } from "./redirects";
import { DOC_PAGES } from "../../website/lib/docs-registry";

/**
 * Build a set of existing page slugs from the docs registry.
 * Slugs are the canonical URLs without /docs prefix or .md extension.
 */
function getExistingPageSlugs(): Set<string> {
  return new Set(DOC_PAGES.map((p) => p.slug));
}

/**
 * Validate a redirect map against the current page registry.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
function validateRedirects(
  redirects: Redirect[],
  existingPages: Set<string>,
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  const sources = new Set<string>();
  const destinations = new Set<string>();

  for (let i = 0; i < redirects.length; i++) {
    const r = redirects[i];

    // Check format: must start with /docs/, no trailing slash
    if (!r.source.startsWith("/docs/")) {
      errors.push(`Entry ${i}: source must start with /docs/, got "${r.source}"`);
    }
    if (r.source.endsWith("/")) {
      errors.push(`Entry ${i}: source must not have trailing slash, got "${r.source}"`);
    }
    if (!r.destination.startsWith("/docs/")) {
      errors.push(`Entry ${i}: destination must start with /docs/, got "${r.destination}"`);
    }
    if (r.destination.endsWith("/")) {
      errors.push(`Entry ${i}: destination must not have trailing slash, got "${r.destination}"`);
    }

    // Check permanent flag
    if (r.permanent !== true) {
      errors.push(`Entry ${i}: must use permanent: true (HTTP 308), got ${r.permanent}`);
    }

    // Extract slugs (remove /docs/ prefix)
    const sourceSlug = r.source.slice("/docs/".length);
    const destSlug = r.destination.slice("/docs/".length);

    // Check for whitespace
    if (/\s/.test(sourceSlug)) {
      errors.push(`Entry ${i}: source slug contains whitespace: "${sourceSlug}"`);
    }
    if (/\s/.test(destSlug)) {
      errors.push(`Entry ${i}: destination slug contains whitespace: "${destSlug}"`);
    }

    // Check for self-redirect
    if (r.source === r.destination) {
      errors.push(
        `Entry ${i}: source and destination are identical "${r.source}" — remove this entry`,
      );
    }

    // Check for duplicate sources
    if (sources.has(r.source)) {
      errors.push(`Entry ${i}: duplicate source "${r.source}"`);
    }
    sources.add(r.source);

    // Check for redirect chains (destination also a source)
    if (sources.has(r.destination)) {
      errors.push(
        `Entry ${i}: destination "${r.destination}" is also a source elsewhere — redirect chains hurt SEO and user experience`,
      );
    }

    // Check that destination page exists
    if (!existingPages.has(destSlug)) {
      errors.push(
        `Entry ${i}: destination page "${destSlug}" does not exist. Valid pages: ${Array.from(existingPages)
          .sort()
          .join(", ")}`,
      );
    }

    // Check that source does NOT currently exist (else the redirect shadows a live page)
    if (existingPages.has(sourceSlug)) {
      errors.push(
        `Entry ${i}: source page "${sourceSlug}" currently exists — this redirect would shadow a live page. Remove the entry or move the live page first.`,
      );
    }

    destinations.add(r.destination);
  }

  // Check for cycles: no destination should also be a source
  for (const dest of destinations) {
    if (sources.has(dest)) {
      const idx = redirects.findIndex((r) => r.source === dest);
      errors.push(
        `Cycle detected: entry ${idx} has source "${dest}" which is a destination elsewhere`,
      );
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

describe("docs redirects", () => {
  let existingPages: Set<string>;

  beforeAll(() => {
    existingPages = getExistingPageSlugs();
  });

  it("happy path: all redirects are valid", () => {
    const result = validateRedirects(REDIRECTS, existingPages);
    if (!result.valid) {
      throw new Error(
        `Redirect validation failed:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
  });

  it("every destination points to an existing page", () => {
    for (const r of REDIRECTS) {
      const slug = r.destination.slice("/docs/".length);
      expect(existingPages.has(slug), `destination "${slug}" from ${r.source} must exist`).toBe(
        true,
      );
    }
  });

  it("no redirect chains or cycles", () => {
    const sources = new Set(REDIRECTS.map((r) => r.source));
    const destinations = new Set(REDIRECTS.map((r) => r.destination));
    for (const dest of destinations) {
      expect(sources.has(dest), `destination ${dest} must not also be a source`).toBe(false);
    }
  });

  it("no duplicate sources", () => {
    const sources = REDIRECTS.map((r) => r.source);
    const uniqueSources = new Set(sources);
    expect(uniqueSources.size, "all sources must be unique").toBe(sources.length);
  });

  it("no self-redirects", () => {
    for (const r of REDIRECTS) {
      expect(r.source !== r.destination, `self-redirect detected: ${r.source}`).toBe(true);
    }
  });

  it("all sources and destinations start with /docs/ and have no trailing slash", () => {
    for (const r of REDIRECTS) {
      expect(r.source.startsWith("/docs/"), `source must start with /docs/: ${r.source}`).toBe(
        true,
      );
      expect(r.source.endsWith("/"), `source must not end with /: ${r.source}`).toBe(false);
      expect(r.destination.startsWith("/docs/"), `destination must start with /docs/: ${r.destination}`).toBe(true);
      expect(r.destination.endsWith("/"), `destination must not end with /: ${r.destination}`).toBe(false);
    }
  });

  it("all redirects use permanent: true (HTTP 308)", () => {
    for (const r of REDIRECTS) {
      expect(r.permanent, `entry ${r.source} must use permanent: true`).toBe(true);
    }
  });

  it("the known moved pages from commit b090884 are present", () => {
    const expectedMoves = [
      { source: "/docs/agent-keys", destination: "/docs/agent-tooling/agent-keys" },
      { source: "/docs/policies", destination: "/docs/agent-tooling/policies" },
      { source: "/docs/mcp-payer", destination: "/docs/agent-tooling/mcp-payer" },
      { source: "/docs/vscode", destination: "/docs/agent-tooling/vscode" },
      { source: "/docs/introduction", destination: "/docs/getting-started/introduction" },
      { source: "/docs/installation", destination: "/docs/getting-started/installation" },
      { source: "/docs/how-it-works", destination: "/docs/getting-started/how-it-works" },
      { source: "/docs/quickstart", destination: "/docs/getting-started/quickstart" },
    ];

    for (const expected of expectedMoves) {
      const found = REDIRECTS.find(
        (r) => r.source === expected.source && r.destination === expected.destination,
      );
      expect(found, `redirect from ${expected.source} to ${expected.destination} not found`)
        .toBeDefined();
    }
  });

  describe("validation function", () => {
    it("rejects an entry with a dangling destination", () => {
      const bad = [{ source: "/docs/old", destination: "/docs/does-not-exist", permanent: true as const }];
      const result = validateRedirects(bad, existingPages);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join("\n")).toContain("does not exist");
      }
    });

    it("rejects a self-redirect", () => {
      const bad = [{ source: "/docs/same", destination: "/docs/same", permanent: true as const }];
      const result = validateRedirects(bad, existingPages);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join("\n")).toContain("identical");
      }
    });

    it("rejects a redirect chain", () => {
      const bad = [
        { source: "/docs/old1", destination: "/docs/x402", permanent: true as const },
        { source: "/docs/x402", destination: "/docs/x402", permanent: true as const },
      ];
      const result = validateRedirects(bad, existingPages);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join("\n")).toContain("also a source");
      }
    });

    it("rejects duplicate sources", () => {
      const bad = [
        { source: "/docs/old", destination: "/docs/new1", permanent: true as const },
        { source: "/docs/old", destination: "/docs/new2", permanent: true as const },
      ];
      const result = validateRedirects(bad, existingPages);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join("\n")).toContain("duplicate source");
      }
    });

    it("rejects a source that shadows an existing page", () => {
      // Use a known existing page as the "old" source
      const existingPage = Array.from(existingPages)[0];
      const bad = [
        {
          source: `/docs/${existingPage}`,
          destination: "/docs/agent-tooling/agent-keys",
          permanent: true as const,
        },
      ];
      const result = validateRedirects(bad, existingPages);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join("\n")).toContain("currently exists");
      }
    });

    it("rejects entries without /docs/ prefix", () => {
      const bad = [{ source: "/old", destination: "/docs/new", permanent: true as const }];
      const result = validateRedirects(bad, existingPages);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join("\n")).toContain("must start with /docs/");
      }
    });

    it("rejects entries with trailing slashes", () => {
      const bad = [{ source: "/docs/old/", destination: "/docs/new", permanent: true as const }];
      const result = validateRedirects(bad, existingPages);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join("\n")).toContain("trailing slash");
      }
    });

    it("rejects entries with permanent: false", () => {
      const bad = [
        { source: "/docs/old", destination: "/docs/new", permanent: false as const },
      ];
      const result = validateRedirects(bad, existingPages);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.join("\n")).toContain("HTTP 308");
      }
    });
  });
});
