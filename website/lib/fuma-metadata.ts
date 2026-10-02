// Pure helper behind lib/fuma-source.ts's per-file schema.
//
// content/docs/*.md files are intentionally frontmatter-free (see
// docs-registry.ts's module comment) — DOC_PAGES is the single hand-edited
// source of truth for title/description. fumadocs-mdx's `pageSchema`
// requires `title` in frontmatter, though, so every page needs *some*
// frontmatter to validate against.
//
// Rather than writing generated frontmatter into the real content files (or
// a shadow copy of them), fumadocs-mdx's collection `schema` option can be a
// function of `{ path, source }` per file (see fumadocs-mdx's
// `CollectionSchema` type) — `path` is the file's absolute disk path. We use
// that hook to build a *per-file* zod schema whose title/description
// default to the registry's values, so a `.md` file with zero frontmatter
// still validates, while a page that *did* carry frontmatter (not expected
// here, but kept as an escape hatch) would still be able to override it.
//
// This function is pure (no fs, no zod) so it's trivially testable: given a
// file's absolute path and the registry, find the matching DOC_PAGES entry.

import type { DocPage } from "./docs-registry";

/**
 * Match an absolute (or any-prefixed) file path against a page's slug. The
 * path always ends in `<slug>.md` relative to content/docs, regardless of
 * what sits before it (repo root, absolute, posix or win32 — fumadocs-mdx's
 * schema context always hands us a posix-style absolute path in practice,
 * but we only rely on a suffix match so the separator style doesn't matter).
 */
export function findPageForContentPath(
  filePath: string,
  pages: DocPage[],
): DocPage | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  return pages.find((p) => normalized.endsWith(`/content/docs/${p.slug}.md`));
}
