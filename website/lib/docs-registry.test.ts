import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOC_PAGES } from "./docs-registry";

// Drift check: DOC_PAGES (the hand-edited source of truth — see this file's
// module comment) and content/docs/*.md on disk must describe exactly the
// same set of pages. A page registered without a file 404s silently in
// dev/build until someone navigates to it; a file added without a registry
// entry builds (fumadocs will pick it up) but never appears in the sidebar,
// llms.txt, or sitemap.xml — both failure modes are easy to introduce by
// editing only one side, so this fails loudly on either direction of drift.

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "docs");

function listMarkdownSlugs(dir: string, prefix = ""): string[] {
  const slugs: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      slugs.push(...listMarkdownSlugs(full, prefix ? `${prefix}/${entry}` : entry));
    } else if (entry.endsWith(".md")) {
      const base = entry.slice(0, -".md".length);
      slugs.push(prefix ? `${prefix}/${base}` : base);
    }
  }
  return slugs;
}

describe("DOC_PAGES / content/docs drift", () => {
  const registrySlugs = DOC_PAGES.map((p) => p.slug);
  const diskSlugs = listMarkdownSlugs(CONTENT_DIR);

  it("every DOC_PAGES slug has a content/docs/<slug>.md file on disk", () => {
    const missing = registrySlugs.filter((slug) => !diskSlugs.includes(slug));
    expect(missing, `registered but missing on disk: ${missing.join(", ")}`).toEqual([]);
  });

  it("every content/docs/*.md file has a DOC_PAGES entry", () => {
    const unregistered = diskSlugs.filter((slug) => !registrySlugs.includes(slug));
    expect(unregistered, `on disk but not registered: ${unregistered.join(", ")}`).toEqual([]);
  });

  it("has no stray files alongside the .md sources (e.g. a leftover meta.json diff)", () => {
    // Guards the relative() call above actually walked real content — if
    // CONTENT_DIR ever resolved to an empty/wrong directory both drift
    // checks above would vacuously pass.
    expect(diskSlugs.length).toBeGreaterThan(0);
    expect(diskSlugs.length).toBe(registrySlugs.length);
  });
});
