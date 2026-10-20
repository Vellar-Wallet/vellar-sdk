# Docs Redirect Map

Preserves indexed links when docs pages are moved or renamed.

## Overview

When a docs page is moved to a new directory or given a new slug, old indexed links (from search engines, bookmarks, and external documentation) become 404s. This utility maintains a redirect map that's wired into the website's Next.js config to preserve those links using permanent redirects (HTTP 308), which transfer search engine ranking to the new URL.

## Files

- **`redirects.ts`**: Exported `Redirect[]` array consumed by `website/next.config.ts`
- **`redirects.test.ts`**: Comprehensive validation suite covering format, destinations, chains, cycles, and duplicates

## How to Add a Redirect

### When

Add an entry whenever you:
- Rename a `.md` file in `website/content/docs/`
- Move a page to a different directory (e.g. `docs/foo.md` → `docs/section/foo.md`)
- Change the `slug` frontmatter field

### Format

Edit `redirects.ts` and add to the `REDIRECTS` array:

```typescript
{ source: "/docs/old-slug", destination: "/docs/new-slug", permanent: true }
```

### Rules

- `source` and `destination` must start with `/docs/` (no trailing slash)
- Always use `permanent: true` (HTTP 308)
- Destination must be a page that currently exists
- Do not create chains (a destination cannot also be a source)
- Do not shadow existing pages (source must not be a live page)

### Example

If you rename `website/content/docs/my-guide.md` and move it into Getting Started:

```typescript
// Old: docs/my-guide.md
// New: docs/getting-started/quickstart.md

{ source: "/docs/my-guide", destination: "/docs/getting-started/quickstart", permanent: true }
```

## Testing

The validation test (`redirects.test.ts`) runs in CI and checks for common mistakes:

```sh
cd website
npm test
```

Or run just the redirects tests:

```sh
npx vitest run contrib/docs-redirect-map/redirects.test.ts
```

Tests cover:
- ✓ All destinations exist
- ✓ No self-redirects
- ✓ No redirect chains
- ✓ No duplicate sources
- ✓ No cycles
- ✓ No shadowed pages
- ✓ Format validation (/docs/ prefix, no trailing slash, permanent: true)
- ✓ Known moved pages from major restructuring (commit b090884)

If any test fails, the error message names the offending entry so you can fix it quickly.

## Important Notes

- **Do not delete old entries.** Indexed links live for years. If a page was already redirected, keep the chain on the destination, not the source.
- **Fragments cannot be redirected.** Anchors (`#section-name`) never reach the server, so if a heading was renamed, manually update links to it elsewhere in the docs or external sites.
- **Query strings are preserved.** Next.js automatically includes query parameters in the destination URL.

## Integration

The website's `website/next.config.ts` imports and uses the redirects:

```typescript
import { REDIRECTS } from "../contrib/docs-redirect-map/redirects";

// ...

async redirects() {
  return REDIRECTS;
}
```

Redirects are applied at the Next.js platform level (Vercel) on all requests to the old URL.

## History

This map was created to preserve indexed links from the major docs restructuring (commit b090884), where pages were reorganized into topic sections (Getting Started, Buyers, Sellers, Concepts, Agent Tooling, Operators, Architecture, Reference). The following pages were moved:

- Agent Tooling: agent-keys, policies, mcp-payer, vscode
- Getting Started: introduction, installation, how-it-works, quickstart
