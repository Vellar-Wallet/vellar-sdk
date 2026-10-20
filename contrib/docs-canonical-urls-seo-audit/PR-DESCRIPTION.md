# Pull Request: Add Canonical URLs and SEO Audit for Docs Site

**Closes:** #595  
**Target Branch:** `dev`  
**Type:** Enhancement (SEO)

## Summary

This PR adds canonical URL tags to all docs pages and implements a multi-layered strategy to prevent search engines from indexing the raw markdown route as a duplicate. The solution:

1. **Centralizes origin configuration** — Single `CANONICAL_ORIGIN` constant
2. **Emits canonical tags** — Via Next.js Metadata API (no hand-written `<link>` tags)
3. **Excludes markdown from indexes** — Using `robots.txt` Disallow + X-Robots-Tag noindex + Link canonical headers
4. **Tests comprehensively** — 48 new tests covering URL construction, per-page audits, and header validation

## Problem

The Fumadocs-based website serves pages through two paths:
- `/docs/[...slug]/page.tsx` — canonical HTML docs pages
- `/md/[...slug]/route.ts` — raw markdown endpoint (via `/docs/<slug>.md` rewrite)

Without canonical URL tags, search engines may index both as separate duplicate pages, diluting SEO signals and wasting crawl budget.

## Solution

### 1. Canonical URL Helper

New file: `website/lib/canonical-url.ts`

```typescript
export const CANONICAL_ORIGIN = "https://docs.vellar.xyz";

export function getCanonicalUrl(slug: string): string {
  // Constructs safe canonical URLs with proper URL encoding
}
```

**Why:** Centralizes the origin and slug-to-URL logic so canonicals stay consistent across the app.

### 2. Website App Updates

**`website/app/layout.tsx`**
- Add `metadataBase: new URL(CANONICAL_ORIGIN)`
- Ensures all child pages resolve relative canonical URLs to the correct origin

**`website/app/docs/page.tsx`**
- Add metadata export with `alternates: { canonical: getCanonicalUrl("") }`
- Prevents duplicate indexing of the `/docs` index

**`website/app/docs/[...slug]/page.tsx`**
- Update `generateMetadata()` to emit `alternates: { canonical: getCanonicalUrl(slug) }`
- Next.js renders exactly one canonical tag per page

**`website/app/md/[...slug]/route.ts`**
- Add multi-layered indexing headers:
  - `X-Robots-Tag: noindex`
  - `Link: <canonical>; rel="canonical"`
- Keeps markdown accessible for AI tools, but out of search indexes

**`website/app/robots.txt/route.ts`**
- Add `Disallow: /md/`
- Tells crawlers not to fetch the markdown route (saves crawl budget)

### 3. Multi-Layered Indexing Strategy

**Why three layers?**

1. **`robots.txt` Disallow: /md/**
   - Limitation: doesn't prevent indexing if other sites link to it
   - Benefit: saves crawl budget, clear intent signal

2. **`X-Robots-Tag: noindex` header**
   - Limitation: only works if crawler fetches the page
   - Benefit: most reliable for non-HTML responses

3. **`Link: <canonical>; rel="canonical"` header**
   - Limitation: not all search engines support it for non-HTML
   - Benefit: consolidates signals to HTML version

**Result:** Strong redundant signal that markdown is not authoritative.

### 4. Comprehensive Testing

New test files: `website/lib/canonical-url*.test.ts` and `website/lib/markdown-route.test.ts`

**48 tests covering:**
- URL construction (normal, nested, index slugs)
- Special character encoding (spaces, %, &, etc.)
- Per-page audit (every page has exactly one canonical)
- No duplicate canonicals
- Markdown route headers validation
- robots.txt generation
- Multi-layered indexing strategy

## Files Changed

### New Files (7)
- `website/lib/canonical-url.ts` — Canonical URL helper and origin constant
- `website/lib/canonical-url.test.ts` — URL construction tests (17 tests)
- `website/lib/canonical-url-audit.test.ts` — Per-page audit tests (15 tests)
- `website/lib/markdown-route.test.ts` — Header and robots.txt tests (16 tests)
- `website/README.md` — SEO documentation

### Modified Files (5)
- `website/app/layout.tsx` — Add metadataBase
- `website/app/docs/page.tsx` — Add metadata export with canonical
- `website/app/docs/[...slug]/page.tsx` — Update generateMetadata to emit canonical
- `website/app/md/[...slug]/route.ts` — Add X-Robots-Tag and Link headers
- `website/app/robots.txt/route.ts` — Add Disallow: /md/ rule

**Total: 12 files changed**

## Verification

### Tests
```bash
npm test
```

**Result:** 62+ tests passing (including existing tests)

### Build
```bash
npm run build
```

**Result:** Build successful, 104+ static pages generated, no errors

### Canonical Tags
```bash
npm start  # in another terminal

curl -s http://localhost:3000/docs/getting-started/quickstart | grep canonical
# <link rel="canonical" href="https://docs.vellar.xyz/docs/getting-started/quickstart"/>
```

### Markdown Route Headers
```bash
curl -I http://localhost:3000/docs/getting-started/quickstart.md
# X-Robots-Tag: noindex
# Link: <https://docs.vellar.xyz/docs/getting-started/quickstart>; rel="canonical"
# Content-Type: text/markdown; charset=utf-8
```

### robots.txt
```bash
curl http://localhost:3000/robots.txt
# User-agent: *
# Allow: /
# Disallow: /md/
# Sitemap: https://docs.vellar.xyz/sitemap.xml
```

All verification steps pass ✓

## Design Decisions

### Why Metadata API, Not Hand-Written Tags?

Using Next.js `generateMetadata()` with `alternates.canonical`:
- Next.js dedupes and renders exactly one tag
- No risk of hand-written duplicates
- Centralizes canonical logic in one place
- Follows Next.js best practices

### Why Single CANONICAL_ORIGIN Constant?

Centralizing `https://docs.vellar.xyz` in one place:
- Single source of truth for the origin
- Easy to change in future (one edit, not many)
- Reusable across metadata, tests, robots.txt
- No hardcoding in multiple places

### Why Markdown Route Stays Accessible?

Route is intentionally not blocked (no 404) because:
- AI tools and agents use it for LLM context via `/docs/<slug>.md` rewrites
- The route is intentional, not a bug
- Exclusion from search indexes is about SEO, not access control

## Acceptance Criteria

- [x] Each docs page has a canonical link tag pointing at its single preferred `docs.vellar.xyz` URL
- [x] A test asserts every rendered docs page includes exactly one canonical tag matching its own slug
- [x] The website README documents why the markdown route is intentionally excluded from indexing
- [x] `robots.txt` handling of the raw markdown route is verified against the intended behavior
- [x] Unit tests cover the happy path and the key failure modes
- [x] Implementation follows existing code style and error-handling conventions
- [x] All 62+ tests passing
- [x] Build successful (104+ pages)
- [x] HTML-level verification confirms canonical tags and headers work
- [x] PR targets the `dev` branch

## Testing Instructions

```bash
# Clone/pull the branch
git checkout feat/docs-canonical-urls

# Navigate to website directory
cd website

# Run tests
npm test

# Build
npm run build

# Start dev server
npm start

# In another terminal, verify
curl -s http://localhost:3000/docs/x402 | grep canonical
curl -I http://localhost:3000/docs/x402.md
curl http://localhost:3000/robots.txt
```

## Related Documentation

- Implementation guide: `IMPLEMENTATION-STEPS.md`
- Verification guide: `VERIFICATION-GUIDE.md`
- Issue: #595

## Notes for Reviewers

1. **Backward Compatible** — No breaking changes, only additions
2. **No New Dependencies** — Uses only existing Next.js and Vitest APIs
3. **Well Tested** — 48 new tests, all passing
4. **Production Ready** — Verified build and verified at HTML level
5. **Future Proof** — Single origin constant makes domain changes easy
6. **Markdown Route Intentional** — Deliberately kept accessible for AI tools, only excluded from search

## Questions?

- Why canonical URLs? → See issue #595 for full context
- How does this work technically? → See IMPLEMENTATION-STEPS.md
- How do I verify it? → See VERIFICATION-GUIDE.md
- What's the multi-layered strategy? → See README.md in this PR
