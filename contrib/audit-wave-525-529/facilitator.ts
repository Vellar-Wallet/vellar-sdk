// Facilitator defaults shared by every package that talks to the hosted
// Bazaar (the CLI and the MCP payer). One copy, so a host migration is one
// edit and the two cannot silently point at different facilitators.
// Dependency-free, like the other x402 subpath modules.

/** Hosted facilitator, used when no override is configured. */
export const DEFAULT_FACILITATOR_URL = "https://vellar-facilitator.onrender.com";

/** Path of the Bazaar search endpoint on a facilitator. */
export const DISCOVERY_SEARCH_PATH = "/discovery/search";

/**
 * Build the Bazaar search URL. The endpoint takes `query`, not `q`: a wrong key
 * is not an error, it returns an unfiltered listing that looks like a working
 * search.
 */
export function buildDiscoverySearchUrl(base: string, query: string, limit: number | string): URL {
  const url = new URL(DISCOVERY_SEARCH_PATH, base);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  return url;
}
