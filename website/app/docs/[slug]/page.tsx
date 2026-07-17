import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DOC_PAGES, getDocMarkdown, getDocPage } from "@/lib/docs";
import { Markdown } from "../markdown";

// Statically generate one page per doc in the registry.
export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getDocPage(slug);
  if (!page) return { title: "Docs — Vellar SDK" };
  return { title: `${page.title} — Vellar SDK` };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = getDocPage(slug);
  if (!page) notFound();

  const markdown = getDocMarkdown(slug);
  const index = DOC_PAGES.findIndex((p) => p.slug === slug);
  const prev = index > 0 ? DOC_PAGES[index - 1] : undefined;
  const next = index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : undefined;

  return (
    <article className="docs-article">
      <p className="docs-eyebrow mono">{page.section}</p>
      <h1 className="docs-title">{page.title}</h1>
      <div className="docs-prose">
        <Markdown>{markdown}</Markdown>
      </div>

      <nav className="docs-pager">
        {prev ? (
          <Link href={`/docs/${prev.slug}`} className="docs-pager-link">
            <span className="docs-pager-dir">← Previous</span>
            <span className="docs-pager-title">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/docs/${next.slug}`} className="docs-pager-link docs-pager-next">
            <span className="docs-pager-dir">Next →</span>
            <span className="docs-pager-title">{next.title}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}
