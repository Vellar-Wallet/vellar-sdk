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

export function getDocMarkdown(slug: string): string {
  const raw = readDocSource(slug);
  // Rewrite in-repo relative links (./foo.md, ./foo.md#anchor) to /docs routes,
  // and strip the leading top-level "# Title" — the page renders its own title
  // from the registry. Slugs can carry digits (x402), so the class is [a-z0-9-].
  return raw
    .replace(/\]\(\.\/([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/gi, "](/docs/$1$2)")
    .replace(/^#\s+.+\n/, "");
}
