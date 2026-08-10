// Raw-markdown view of a docs page, reached as /docs/<slug>.md via the
// rewrite in next.config.ts. Statically generated per registry page.

import { getAgentMarkdown } from "@/lib/docs-agent";
import { DOC_PAGES } from "@/lib/docs-registry";

export const dynamic = "force-static";

export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const markdown = getAgentMarkdown(slug);
  if (!markdown) return new Response("Not found", { status: 404 });
  return new Response(markdown, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
