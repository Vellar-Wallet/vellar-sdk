// robots.txt — kept beside the sitemap route so the two cannot disagree about
// the site's own URL.

import { SITE_URL } from "@/lib/docs-agent";

export const dynamic = "force-static";

export function GET() {
  const body = ["User-agent: *", "Allow: /", `Sitemap: ${SITE_URL}/sitemap.xml`, ""].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
