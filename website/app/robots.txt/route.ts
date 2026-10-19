// robots.txt — kept beside the sitemap route so the two cannot disagree about
// the site's own URL.
//
// The /md/ route is explicitly disallowed from crawling to work in concert with
// the X-Robots-Tag: noindex header on markdown responses. This ensures:
// 1. Crawlers don't waste resources fetching the markdown copies
// 2. The HTML docs pages (the canonical versions) get priority in crawls
// 3. Combined with the Link: <canonical> headers, this signals that markdown
//    copies are not the authoritative version
//
// Note: Disallow alone doesn't prevent indexing (a URL can be indexed via
// cross-site links). The X-Robots-Tag header is the reliable mechanism here,
// but Disallow + noindex header + canonical Link header together create a
// strong, redundant signal to search engines.

import { SITE_URL } from "@/lib/docs-agent";

export const dynamic = "force-static";

export function GET() {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /md/",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
