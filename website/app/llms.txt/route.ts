// llms.txt — the standard agent-facing index of these docs.

import { getLlmsIndex } from "@/lib/docs-agent";

export const dynamic = "force-static";

export function GET() {
  return new Response(getLlmsIndex(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
