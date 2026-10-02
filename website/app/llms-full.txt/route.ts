// llms-full.txt — the entire docs corpus in one file, for AI agents.

import { getLlmsFull } from "@/lib/docs-agent";

export const dynamic = "force-static";

export function GET() {
  return new Response(getLlmsFull(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
