import { readFileSync } from "node:fs";
import { join } from "node:path";

// Server-only docs file reader (uses node:fs — never import from a client
// component). The client-safe registry lives in ./docs-registry and is
// re-exported here for server callers' convenience.
export { DOC_PAGES, DOC_SECTIONS, getDocPage, type DocPage } from "./docs-registry";

const CONTENT_DIR = join(process.cwd(), "content", "docs");

export function getDocMarkdown(slug: string): string {
  const raw = readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8");
  // Rewrite in-repo relative links (./foo.md, ./foo.md#anchor) to /docs routes,
  // and strip the leading top-level "# Title" — the page renders its own title
  // from the registry.
  return raw
    .replace(/\]\(\.\/([a-z-]+)\.md(#[a-z0-9-]+)?\)/gi, "](/docs/$1$2)")
    .replace(/^#\s+.+\n/, "");
}
