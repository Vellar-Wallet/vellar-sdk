import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOC_PAGES } from "./docs-registry";

const docsRoot = path.resolve(__dirname, "../content/docs");
const pagePath = (slug: string) => path.join(docsRoot, `${slug}.md`);

describe("docs registry", () => {
  it("has unique slugs", () => {
    const slugs = DOC_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has a content file for every registered page", () => {
    for (const page of DOC_PAGES) {
      expect(existsSync(pagePath(page.slug)), page.slug).toBe(true);
    }
  });

  it("registers the policies-vs-multisig page in the architecture tab", () => {
    const page = DOC_PAGES.find((p) => p.slug === "architecture/policies-vs-multisig");
    expect(page?.tab).toBe("architecture");
  });

  it("resolves every relative .md link on the registered pages", () => {
    for (const page of DOC_PAGES) {
      const file = pagePath(page.slug);
      if (!existsSync(file)) continue;
      const md = readFileSync(file, "utf8");
      for (const m of md.matchAll(/\]\((\.{1,2}\/[^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
        const target = path.resolve(path.dirname(file), m[1]);
        expect(existsSync(target), `${page.slug} -> ${m[1]}`).toBe(true);
      }
    }
  });
});
