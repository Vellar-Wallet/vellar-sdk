// Builds the four tab-scoped page trees fumadocs' DocsLayout/PageFooter
// consume for the sidebar and prev/next pager.
//
// Fumadocs' own page tree is built from the content/docs folder structure
// (one meta.json per directory), but DOC_SECTIONS groups pages by a
// hand-edited `section`/`tab` that cuts across directories — e.g. "Reference"
// spans root-level files, reference/*.md, and agent-tooling/agent-keys.md.
// A folder-structure-driven tree can't express that grouping, so rather than
// contort content/docs' directories to match the sidebar (or fight
// meta.json's `pages`/`...folder` extend syntax to stitch them back
// together), we build the tree directly from DOC_SECTIONS — the same
// approach app/docs/docs-nav.tsx used before this migration, just producing
// a fumadocs page-tree shape instead of JSX.
//
// This is a pure function (no fs, no fumadocs loader calls) so it's fully
// unit-testable: given DOC_SECTIONS-shaped input, assert the exact tree
// shape, including that `hidden` pages are excluded.
//
// TabPageTree/TabPageTreeFolder/TabPageTreeItem below are plain structural
// types matching fumadocs-core@15.7.13's internal page-tree definitions
// exactly (that version doesn't publicly export them from any subpath — see
// node_modules/fumadocs-core/dist/definitions-*.d.ts for the source of
// truth this was copied from) — defining them locally is no different at
// the type level than importing a re-export would be, since they describe
// plain data with no runtime behaviour attached.
import { DOC_SECTIONS, DOC_TABS, type DocPage, type DocTabId } from "./docs-registry";

export interface TabPageTreeItem {
  $id?: string;
  type: "page";
  name: string;
  url: string;
  description?: string;
}
export interface TabPageTreeFolder {
  $id?: string;
  type: "folder";
  name: string;
  children: TabPageTreeItem[];
}
/**
 * Structurally compatible with fumadocs-core's PageTree.Root (a superset —
 * DocsLayout's `tree` prop accepts this fine), so it's accepted wherever the
 * real type is expected without importing it (see this file's module
 * comment for why it isn't imported).
 */
export interface TabPageTree {
  name: string;
  children: TabPageTreeFolder[];
}

/**
 * One tab's page tree: a flat list of section folders, each containing its
 * pages in DOC_PAGES order. Hidden pages are never passed in (callers should
 * already be using DOC_SECTIONS-filtered input), but this stays defensive
 * since a tree with a hidden page in it would leak that page into the
 * sidebar and into findPagerNeighbours' prev/next for its neighbours.
 */
export function buildTabPageTree(
  tab: DocTabId,
  sections: { section: string; pages: DocPage[] }[],
): TabPageTree {
  const children: TabPageTreeFolder[] = sections
    .filter((s) => s.pages[0]?.tab === tab)
    .map((s) => ({
      type: "folder" as const,
      name: s.section,
      // A group that's just one self-titled page reads fine without a
      // folder label getting rendered — matches docs-nav.tsx's
      // `group.pages.length > 1 || group.pages[0]?.nav !== group.section`
      // check, applied here instead so the tree itself already reflects it.
      ...(s.pages.length === 1 && s.pages[0].nav === s.section
        ? {}
        : { $id: `section:${s.section}` }),
      children: s.pages
        .filter((p) => !p.hidden)
        .map((p) => ({
          type: "page" as const,
          $id: p.slug,
          name: p.nav,
          url: `/docs/${p.slug}`,
          description: p.description,
        })),
    }))
    .filter((folder) => folder.children.length > 0);

  return {
    name: "Docs",
    children,
  };
}

/** One tree per tab, in DOC_TABS order. */
export function buildAllTabPageTrees(
  tabs: { id: DocTabId }[],
  sections: { section: string; pages: DocPage[] }[],
): Record<DocTabId, TabPageTree> {
  const out = {} as Record<DocTabId, TabPageTree>;
  for (const { id } of tabs) {
    out[id] = buildTabPageTree(id, sections);
  }
  return out;
}

/**
 * Previous/next page for `url`, walking the tree's folders in order and
 * flattening their children — equivalent to fumadocs-core's findNeighbour
 * (added in a later fumadocs-core release than the one this app pins; see
 * this file's module comment), re-implemented here as a pure function since
 * the tree shape above is entirely our own anyway. A page's neighbours are
 * always within the same tab's tree, so a hidden page (absent from every
 * tab's tree — see buildTabPageTree) can never surface as one.
 */
export function findPagerNeighbours(
  tree: TabPageTree,
  url: string,
): { previous?: TabPageTreeItem; next?: TabPageTreeItem } {
  const flat = tree.children.flatMap((folder) => folder.children);
  const idx = flat.findIndex((item) => item.url === url);
  if (idx === -1) return {};
  return { previous: flat[idx - 1], next: flat[idx + 1] };
}

// Cached singleton built from the real registry, shared by app/docs/layout.tsx
// (needs all four trees, to hand the active one to DocsLayout) and
// app/docs/[...slug]/page.tsx (needs only its own page's tab's tree, for
// findPagerNeighbours). Both run per-request on the server; this avoids
// rebuilding the same four trees twice per request. buildAllTabPageTrees/
// buildTabPageTree stay exported and pure for the unit tests, which pass in
// their own fixture data rather than the real registry.
let cachedTrees: Record<DocTabId, TabPageTree> | undefined;

export function getTabPageTrees(): Record<DocTabId, TabPageTree> {
  if (!cachedTrees) {
    cachedTrees = buildAllTabPageTrees(DOC_TABS, DOC_SECTIONS);
  }
  return cachedTrees;
}
