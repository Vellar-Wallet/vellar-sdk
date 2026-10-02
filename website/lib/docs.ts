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
 * Links are resolved against `fromSlug` — the slug of the page being rendered —
 * exactly the way a relative path works on disk, so a link means the same thing
 * whether the page sits at the docs root or inside a section directory:
 *
 *   from "x402"                  ./facilitator.md          → <base>/facilitator
 *   from "getting-started/setup" ./quickstart.md           → <base>/getting-started/quickstart
 *   from "getting-started/setup" ../x402.md                → <base>/x402
 *   from "x402"                  ./getting-started/intro.md → <base>/getting-started/intro
 *
 * Path segments can carry digits (x402), so the class is [a-z0-9-]; an optional
 * #anchor is preserved. Shared by the HTML renderer and the agent-facing copies
 * so both stay consistent — a link form handled in only one of them renders
 * correctly on the site while arriving raw in llms.txt.
 */
export function rewriteRelativeLinks(raw: string, base: string, fromSlug = ""): string {
  const dir = fromSlug.includes("/") ? fromSlug.slice(0, fromSlug.lastIndexOf("/")) : "";
  return raw.replace(
    /\]\((\.{1,2}\/(?:[a-z0-9-]+\/)*[a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/gi,
    (_m, rel: string, anchor = "") => {
      const segments = dir ? dir.split("/") : [];
      for (const part of rel.split("/")) {
        if (part === ".") continue;
        else if (part === "..") segments.pop();
        else segments.push(part);
      }
      return `](${base}/${segments.join("/")}${anchor})`;
    },
  );
}

export function getDocMarkdown(slug: string): string {
  const raw = readDocSource(slug);
  // Rewrite in-repo relative links to /docs routes, and strip the leading
  // top-level "# Title" — the page renders its own title from the registry.
  // Both sibling (./foo.md) and parent-relative (../section/foo.md) forms are
  // handled; the latter is how a page inside a section directory links out.
  return rewriteRelativeLinks(raw, "/docs", slug).replace(/^#\s+.+\n/, "");
}
