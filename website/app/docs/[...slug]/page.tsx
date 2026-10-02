import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  PageArticle,
  PageBreadcrumb,
  PageFooter,
  PageRoot,
  PageTOC,
  PageTOCItems,
  PageTOCTitle,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { DOC_PAGES, getDocPage } from "@/lib/docs-registry";
import { findPagerNeighbours, getTabPageTrees } from "@/lib/fuma-page-tree";
import { source } from "@/lib/fuma-source";
import { CopyForAgentButton } from "../copy-button";
import { getMDXComponents } from "../mdx-components";

// Statically generate one page per doc in the registry. A catch-all route
// (required, not optional — /docs itself is its own page.tsx that redirects
// to the first registry entry, see app/docs/page.tsx), so a nested slug
// ("getting-started/quickstart") arrives as path segments.
export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getDocPage(slug.join("/"));
  if (!page) return { title: "Docs — Vellar SDK" };
  return { title: `${page.title} — Vellar SDK`, description: page.description };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug: segments } = await params;
  const slug = segments.join("/");
  const registryPage = getDocPage(slug);
  if (!registryPage) notFound();

  const page = source.getPage(segments);
  if (!page) notFound();

  const MDX = page.data.body;
  const url = `/docs/${slug}`;

  // Prev/next walk the same tab-scoped tree the sidebar renders
  // (lib/fuma-page-tree.ts) — so a hidden page (e.g. hackathon, which
  // belongs to no tab's tree) can never appear as a neighbour, and the
  // order matches DOC_PAGES exactly, since that's how the tree itself was
  // built.
  const tree = getTabPageTrees()[registryPage.tab];
  const { previous, next } = findPagerNeighbours(tree, url);

  return (
    <PageRoot toc={{ toc: page.data.toc }}>
      <PageTOC>
        <PageTOCTitle />
        <PageTOCItems />
      </PageTOC>
      <PageArticle>
        <PageBreadcrumb />
        <div className="docs-head">
          <div>
            <p className="docs-eyebrow mono">{registryPage.section}</p>
            <h1 className="docs-title">{registryPage.title}</h1>
          </div>
          <CopyForAgentButton slug={slug} />
        </div>
        <p className="docs-description">{registryPage.description}</p>
        <div className="docs-prose prose">
          <MDX
            components={getMDXComponents({
              a: createRelativeLink(source, page),
            })}
          />
        </div>
        <PageFooter items={{ previous, next }} className="docs-pager" />
      </PageArticle>
    </PageRoot>
  );
}
