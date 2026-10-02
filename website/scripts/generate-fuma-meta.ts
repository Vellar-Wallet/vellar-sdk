#!/usr/bin/env -S node --experimental-strip-types
// Generates one meta.json per content/docs directory from DOC_PAGES, so
// fumadocs-mdx's folder-scoped page ordering follows the registry's order
// without a human ever hand-editing meta.json directly (DOC_PAGES stays the
// single source of truth — see lib/docs-registry.ts).
//
// The *rendered* sidebar does NOT come from these meta.json files or from
// fumadocs' folder-driven tree at all — DOC_SECTIONS groups pages across
// directory boundaries (see lib/fuma-page-tree.ts's module comment), which
// meta.json's directory-scoped `pages` list can't express. These files exist
// so fumadocs-mdx's own internal file discovery/ordering (e.g. `source.
// getPages()`, and the per-directory default ordering it falls back to
// before a custom tree transform runs) stays deterministic and matches
// DOC_PAGES, and so a `content/docs/<dir>/` listed with `ls` or browsed on
// GitHub shows pages in the documented order.
//
// Hidden pages (DOC_PAGES[].hidden) are intentionally left out of every
// meta.json's `pages` list — same filtering DOC_SECTIONS already applies
// (see docs-registry.ts) — so a hidden page's folder entry never appears
// there, while the file itself stays on disk and fully buildable.
//
// Pure generator (buildMetaFiles) + thin fs-writing wrapper (writeMetaFiles),
// mirroring the pure/IO split in lib/docs-agent.ts. Wired into predev/
// prebuild in package.json so it always runs before `next dev`/`next build`.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_PAGES, type DocPage } from "../lib/docs-registry";

/** Directory part of a slug, "" for a page directly under content/docs. */
function slugDir(slug: string): string {
  return slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/")) : "";
}

/** Basename part of a slug (the bit meta.json's `pages` list wants). */
function slugBase(slug: string): string {
  return slug.includes("/") ? slug.slice(slug.lastIndexOf("/") + 1) : slug;
}

/**
 * One meta.json per directory that contains at least one DOC_PAGES entry,
 * keyed by that directory's path relative to content/docs ("" for the root
 * directory itself). Each lists its own pages' basenames in DOC_PAGES order,
 * with hidden pages omitted.
 *
 * Returns { relativePath: jsonContent } — relativePath is e.g.
 * "meta.json" or "getting-started/meta.json" — rather than writing
 * anything, so this stays a pure function callers can unit-test directly.
 */
export function buildMetaFiles(pages: DocPage[]): Record<string, string> {
  const byDir = new Map<string, DocPage[]>();
  for (const page of pages) {
    const dir = slugDir(page.slug);
    const list = byDir.get(dir);
    if (list) list.push(page);
    else byDir.set(dir, [page]);
  }

  const files: Record<string, string> = {};
  for (const [dir, dirPages] of byDir) {
    const visiblePages = dirPages.filter((p) => !p.hidden).map((p) => slugBase(p.slug));
    // A directory whose every page is hidden still gets a meta.json with an
    // empty `pages` list, rather than none at all — the directory's files
    // stay buildable either way, but omitting the file entirely would make
    // fumadocs fall back to alphabetical order the moment a second
    // (non-hidden) page is added there later, silently drifting from
    // DOC_PAGES order until someone notices.
    const json = { pages: visiblePages };
    const path = dir ? `${dir}/meta.json` : "meta.json";
    files[path] = `${JSON.stringify(json, null, 2)}\n`;
  }
  return files;
}

function writeMetaFiles(contentDir: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(contentDir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }
}

function main(): void {
  // Resolved relative to this file, not process.cwd() — same reasoning as
  // lib/docs.ts's CONTENT_DIR: predev/prebuild can run from a different cwd
  // than `website/` depending on how the monorepo's scripts invoke npm.
  const contentDir = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "docs");
  const files = buildMetaFiles(DOC_PAGES);
  writeMetaFiles(contentDir, files);
  console.log(`generate-fuma-meta: wrote ${Object.keys(files).length} meta.json file(s)`);
}

// Only run when executed directly (tsx scripts/generate-fuma-meta.ts), not
// when imported by its test file.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
