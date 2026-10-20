/**
 * Canonical URL construction for docs pages.
 * COPY TO: website/lib/canonical-url.ts
 * 
 * Centralizes the origin and slug-to-URL logic so canonicals stay consistent.
 */

export const CANONICAL_ORIGIN = "https://docs.vellar.xyz";

/**
 * Construct a canonical URL for a docs page.
 * @param slug - The page slug (e.g., "getting-started/quickstart" or an empty string for /docs)
 * @returns The absolute canonical URL, with no query string or fragment
 */
export function getCanonicalUrl(slug: string): string {
  if (!slug || slug === "") {
    return `${CANONICAL_ORIGIN}/docs`;
  }
  const segments = slug.split("/").map((segment) => encodeURIComponent(segment));
  return `${CANONICAL_ORIGIN}/docs/${segments.join("/")}`;
}
