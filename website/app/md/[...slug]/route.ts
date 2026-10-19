// Raw-markdown view of a docs page, reached as /docs/<slug>.md via the
// rewrite in next.config.ts. Statically generated per registry page.
//
// This route deliberately includes:
// - X-Robots-Tag: noindex to prevent search indexing of the markdown copy
// - Link: <canonical>; rel="canonical" to signal the canonical HTML page
// This ensures the raw markdown is not indexed as a separate page, while
// crawlers that fetch markdown can still discover the authoritative HTML version.

import { getAgentMarkdown } from "@/lib/docs-agent";
import { getCanonicalUrl } from "@/lib/canonical-url";
import { DOC_PAGES } from "@/lib/docs-registry";

export const dynamic = "force-static";

export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug.split("/") }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  const pageSlug = slug.join("/");
  const markdown = getAgentMarkdown(pageSlug);
  if (!markdown) return new Response("Not found", { status: 404 });

  const canonicalUrl = getCanonicalUrl(pageSlug);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Link": `<${canonicalUrl}>; rel="canonical"`,
    },
  });
}
