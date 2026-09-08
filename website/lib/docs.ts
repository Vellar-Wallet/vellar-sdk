import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Server-only docs file reader (uses node:fs — never import from a client
// component). The client-safe registry lives in ./docs-registry and is
// re-exported here for server callers' convenience.
export { DOC_PAGES, DOC_SECTIONS, getDocPage, type DocPage } from "./docs-registry";

// Resolved relative to this file, not process.cwd() — a cwd-based path only
// works when the process happens to be launched from website/. It silently
// broke root-level `vitest run` (CI runs it from the repo root, and vitest's
// default discovery picks up this package's tests regardless of cwd) with an
// ENOENT that a website-local `npm test` could never catch.
const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "docs");

/** Raw page source, exactly as authored in content/docs. */
export function readDocSource(slug: string): string {
  return readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8");
}

/**
 * Rewrite in-repo relative markdown links to routes under `base`.
 *
 * Three authored forms are supported, each optionally carrying an #anchor:
 *   ./foo.md              → <base>/foo            (sibling page)
 *   ../section/foo.md     → <base>/section/foo    (page in another section dir)
 *   ../foo.md             → <base>/foo            (page at the docs root)
 *
 * Slugs can carry digits (x402), so the character class is [a-z0-9-]. Shared by
 * the HTML renderer and the agent-facing copies so both stay consistent — a
 * link form handled in only one of them renders correctly on the site while
 * arriving raw in llms.txt.
 */
export function rewriteRelativeLinks(raw: string, base: string): string {
  return raw
    .replace(/\]\(\.\.\/([a-z0-9-]+)\/([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/gi, `](${base}/$1/$2$3)`)
    .replace(/\]\((?:\.\.|\.)\/([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/gi, `](${base}/$1$2)`);
}

export function getDocMarkdown(slug: string): string {
  const raw = readDocSource(slug);
  // Rewrite in-repo relative links to /docs routes, and strip the leading
  // top-level "# Title" — the page renders its own title from the registry.
  // Both sibling (./foo.md) and parent-relative (../section/foo.md) forms are
  // handled; the latter is how a page inside a section directory links out.
  return rewriteRelativeLinks(raw, "/docs").replace(/^#\s+.+\n/, "");
}
