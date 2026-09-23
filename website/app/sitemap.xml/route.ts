// sitemap.xml — generated from the docs registry so a new page is listed the
// moment it is registered. A hand-maintained file in public/ would silently
// fall behind DOC_PAGES, which is the one failure a sitemap cannot survive.

import { DOC_PAGES } from "@/lib/docs-registry";
import { SITE_URL } from "@/lib/docs-agent";

export const dynamic = "force-static";

function urlEntry(loc: string, priority: string): string {
  return [
    "  <url>",
    `    <loc>${loc}</loc>`,
    "    <changefreq>weekly</changefreq>",
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

export function GET() {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlEntry(SITE_URL, "1.0"),
    ...DOC_PAGES.map((page) => urlEntry(`${SITE_URL}/docs/${page.slug}`, "0.8")),
    "</urlset>",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
