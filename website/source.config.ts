import type { Root } from "mdast";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from "fumadocs-mdx/config";
import { z } from "zod";
import { findPageForContentPath } from "./lib/fuma-metadata";
import { DOC_PAGES } from "./lib/docs-registry";

/**
 * Strips the document's leading `# Title` heading, if its first node is one.
 *
 * content/docs/*.md pages each open with their own `# Title` line (it's
 * also how a human reads the file — the title isn't hidden in frontmatter),
 * but the registry's `title` (DOC_PAGES) renders separately as the page's
 * actual <h1> (see app/docs/[...slug]/page.tsx) — so without this, every
 * page would render two H1s: ours, then the content's own. The pre-fumadocs
 * renderer avoided this the same way, just as a string replace in
 * lib/docs.ts's getDocMarkdown (`.replace(/^#\s+.+\n/, "")`) rather than an
 * AST transform — that function is unchanged and still used for the agent-
 * facing .md/llms.txt routes, which keep the H1 (an agent fetching raw
 * markdown has no separate place for the title to live).
 */
function remarkStripLeadingTitle() {
  return (tree: Root) => {
    const first = tree.children[0];
    if (first?.type === "heading" && first.depth === 1) {
      tree.children.shift();
    }
  };
}

// fumadocs-mdx's content collection, pointed at content/docs in place (no
// file moves). Metadata (title/description) comes from DOC_PAGES, not
// frontmatter — content/docs/*.md stays frontmatter-free (see
// docs-registry.ts's module comment for why) and fuma-metadata.ts's
// comment for how the per-file `schema` function below supplies it instead.
//
// `tab` is injected here too so it flows straight through fumadocs' page
// data, where lib/fuma-page-tree.ts reads it back out to build the four
// tab-scoped sidebar/prev-next trees (see that file's module comment for
// why DOC_SECTIONS, not fumadocs' own folder-driven tree, is what actually
// drives the sidebar).
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: (ctx) => {
      const page = findPageForContentPath(ctx.path, DOC_PAGES);
      // Every content/docs/*.md file has a DOC_PAGES entry (enforced by the
      // drift-check test in lib/docs-registry.test.ts) — this branch exists
      // only so an unregistered file fails loudly in the usual fumadocs way
      // (missing `title`) rather than silently, if the drift check is ever
      // bypassed.
      if (!page) return frontmatterSchema;
      return frontmatterSchema.extend({
        title: frontmatterSchema.shape.title.default(page.title),
        description: frontmatterSchema.shape.description.default(page.description),
        tab: z.string().default(page.tab),
      });
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// Global MDX pipeline config, picked up by `createMDX()` in next.config.ts.
//
// remarkMdxMermaid is fumadocs' own documented recipe for live-rendered
// Mermaid diagrams (see fumadocs-core/mdx-plugins): it rewrites a
// ```mermaid fenced code block into a <Mermaid chart="..."> JSX node in the
// MDX AST *before* Shiki's rehype-based syntax highlighting ever sees it —
// so the diagram source never gets turned into a plain highlighted code
// block. The matching `<Mermaid>` client component (app/docs/mermaid.tsx,
// unchanged from the pre-migration renderer) is wired into the MDX
// components map in app/docs/mdx-components.tsx.
//
// Appending to the default plugin list (rather than replacing it) via the
// function form keeps every other fumadocs default — GFM, heading slugs,
// callouts, etc.
export default defineConfig({
  mdxOptions: {
    // remarkStripLeadingTitle runs first so a later plugin never sees the H1
    // this removes (in particular, fumadocs' heading-id/structure plugins,
    // which otherwise index it into the TOC and search as a redundant
    // "Introduction" entry duplicating the page's own title).
    remarkPlugins: (plugins) => [remarkStripLeadingTitle, ...plugins, remarkMdxMermaid],
  },
});
