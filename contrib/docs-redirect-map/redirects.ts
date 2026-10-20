/**
 * Redirect map for moved or renamed docs pages.
 *
 * When a docs page is moved to a new slug or directory, add an entry here to
 * preserve indexed links (search engines, bookmarks, old documentation).
 * See README.md for the contributor process.
 *
 * Format: { source, destination, permanent }
 * Next.js `redirects()` in next.config.ts consumes this directly.
 *
 * - Uses permanent redirects (HTTP 308) so search engines transfer ranking to the new URL.
 * - Destination must be a page that currently exists (validated by redirects.test.ts).
 * - Do not delete old entries casually; indexed links live for years.
 * - Query strings and fragments are preserved by Next.js by default.
 * - Anchors/fragments cannot be redirected (they never reach the server), so renamed
 *   sections need manual link updates where they're cited.
 * - Never add a redirect that shadows an existing page, or create a redirect chain.
 */

export interface Redirect {
  source: string;
  destination: string;
  permanent: true;
}

/**
 * Pages moved during the major docs restructuring (commit b090884):
 * Docs were reorganized into topic sections (Getting Started, Buyers, Sellers, etc.)
 * and navigation was redesigned. These entries preserve links from before the move.
 */
export const REDIRECTS: Redirect[] = [
  // Agent Tooling section
  { source: "/docs/agent-keys", destination: "/docs/agent-tooling/agent-keys", permanent: true },
  { source: "/docs/policies", destination: "/docs/agent-tooling/policies", permanent: true },
  { source: "/docs/mcp-payer", destination: "/docs/agent-tooling/mcp-payer", permanent: true },
  { source: "/docs/vscode", destination: "/docs/agent-tooling/vscode", permanent: true },

  // Getting Started section
  { source: "/docs/introduction", destination: "/docs/getting-started/introduction", permanent: true },
  { source: "/docs/installation", destination: "/docs/getting-started/installation", permanent: true },
  { source: "/docs/how-it-works", destination: "/docs/getting-started/how-it-works", permanent: true },
  { source: "/docs/quickstart", destination: "/docs/getting-started/quickstart", permanent: true },
];
