import { describe, expect, it } from "vitest";
import { buildMetaFiles } from "./generate-fuma-meta";
import { DOC_PAGES, type DocPage } from "../lib/docs-registry";

const page = (over: Partial<DocPage> = {}): DocPage => ({
  slug: "x402",
  title: "x402 Agentic Payments",
  nav: "x402",
  section: "x402 Payments",
  tab: "reference",
  description: "Pay HTTP-402 resources.",
  ...over,
});

describe("buildMetaFiles", () => {
  it("groups pages into one meta.json per directory, keyed by relative path", () => {
    const files = buildMetaFiles([
      page({ slug: "x402" }),
      page({ slug: "getting-started/quickstart" }),
      page({ slug: "getting-started/installation" }),
    ]);
    expect(Object.keys(files).sort()).toEqual(["getting-started/meta.json", "meta.json"]);
  });

  it("lists a directory's pages by basename, in input order", () => {
    const files = buildMetaFiles([
      page({ slug: "getting-started/b" }),
      page({ slug: "getting-started/a" }),
    ]);
    expect(JSON.parse(files["getting-started/meta.json"])).toEqual({ pages: ["b", "a"] });
  });

  it("omits hidden pages from the pages list but still creates the file", () => {
    const files = buildMetaFiles([
      page({ slug: "hackathon", hidden: true }),
    ]);
    expect(JSON.parse(files["meta.json"])).toEqual({ pages: [] });
  });

  it("a directory with a mix of hidden and visible pages lists only the visible ones", () => {
    const files = buildMetaFiles([
      page({ slug: "reference/honesty" }),
      page({ slug: "reference/secret", hidden: true }),
      page({ slug: "reference/proofs" }),
    ]);
    expect(JSON.parse(files["reference/meta.json"])).toEqual({
      pages: ["honesty", "proofs"],
    });
  });

  it("each generated file is valid JSON ending in a trailing newline", () => {
    const files = buildMetaFiles([page()]);
    for (const content of Object.values(files)) {
      expect(content.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(content)).not.toThrow();
    }
  });

  it("produces exactly one meta.json per directory present in the real registry", () => {
    const files = buildMetaFiles(DOC_PAGES);
    const dirs = new Set(
      DOC_PAGES.map((p) => (p.slug.includes("/") ? p.slug.slice(0, p.slug.lastIndexOf("/")) : "")),
    );
    const expectedPaths = [...dirs].map((d) => (d ? `${d}/meta.json` : "meta.json"));
    expect(Object.keys(files).sort()).toEqual(expectedPaths.sort());
  });

  it("every non-hidden DOC_PAGES slug appears exactly once across all generated files", () => {
    const files = buildMetaFiles(DOC_PAGES);
    const allListed = Object.entries(files).flatMap(([path, content]) => {
      const dir = path === "meta.json" ? "" : path.slice(0, -"/meta.json".length);
      return (JSON.parse(content).pages as string[]).map((base) => (dir ? `${dir}/${base}` : base));
    });
    const expectedSlugs = DOC_PAGES.filter((p) => !p.hidden).map((p) => p.slug);
    expect(allListed.sort()).toEqual(expectedSlugs.sort());
  });
});
