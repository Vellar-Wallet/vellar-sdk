import { readFileSync } from "node:fs";
import { join } from "node:path";

// Server-only docs file reader (uses node:fs — never import from a client
// component). The client-safe registry lives in ./docs-registry and is
// re-exported here for server callers' convenience.
export { DOC_PAGES, DOC_SECTIONS, getDocPage, type DocPage } from "./docs-registry";

const CONTENT_DIR = join(process.cwd(), "content", "docs");

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
