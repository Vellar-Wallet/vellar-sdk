# Verification Guide — Testing the Implementation

This guide provides step-by-step verification that the canonical URL and SEO audit implementation works correctly.

## Prerequisites

- Implementation has been integrated into `website/` following `IMPLEMENTATION-STEPS.md`
- Node.js and npm installed
- Dev server running: `npm start` in `website/`

## 1. Unit Tests

### Run All Tests

```bash
cd website
npm test
```

**Expected output:**

```
PASS  lib/canonical-url.test.ts
  getCanonicalUrl
    ✓ returns /docs for an empty slug (docs index)
    ✓ returns /docs/<slug> for a single-segment slug
    ✓ returns /docs/<slug1>/<slug2> for a nested slug
    ✓ URL-encodes special characters in slug segments
    ✓ does not encode hyphens and numbers (valid slug characters)
    ✓ never includes a trailing slash
    ✓ never includes a query string or fragment
    ✓ exports the canonical origin

PASS  lib/canonical-url-audit.test.ts
  canonical URL audit
    ✓ every docs page from the registry has a canonical URL
    ✓ every page's canonical URL contains its slug
    ✓ docs index page (/docs) has its own canonical
    ✓ no two pages share the same canonical URL
    ✓ canonical URL matches getDocPage().slug structure

PASS  lib/markdown-route.test.ts
  markdown route headers and indexing
    ✓ X-Robots-Tag: noindex prevents search engines from indexing
    ✓ Link: canonical header points to the HTML docs page for each slug
    ✓ markdown responses have Content-Type: text/markdown; charset=utf-8
    ✓ robots.txt includes Disallow: /md/
    ✓ robots.txt still allows /docs/ (not disallowed)
    ✓ uses three complementary mechanisms to keep markdown out of search indexes

PASS  lib/docs-agent.test.ts (existing tests)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
62 tests passing
```

**Pass criteria:** All tests pass without errors.

## 2. Build Verification

### Build the Project

```bash
npm run build
```

**Expected output:**

```
✓ Build completed successfully
✓ Routes compiled:
  - /docs (index)
  - /docs/[...slug] (48 pages from registry)
  - /md/[...slug] (48 pages from registry)
  - /robots.txt
  - /sitemap.xml
  - /llms.txt
  - /llms-full.txt
  
✓ Static pages generated: 104
✓ No TypeScript errors
✓ No warnings
```

**Pass criteria:** Build succeeds with no errors.

## 3. Canonical Tags Verification

### Start Dev Server

```bash
npm start
```

Wait for the server to start. Expected output: `> ready started server on 0.0.0.0:3000`

### Test Canonical Tags (in another terminal)

```bash
# Test 1: Docs index page has canonical
curl -s http://localhost:3000/docs | grep -i canonical
```

**Expected output:**
```html
<link rel="canonical" href="https://docs.vellar.xyz/docs"/>
```

```bash
# Test 2: Single-level docs page has canonical
curl -s http://localhost:3000/docs/x402 | grep -i canonical
```

**Expected output:**
```html
<link rel="canonical" href="https://docs.vellar.xyz/docs/x402"/>
```

```bash
# Test 3: Multi-level docs page has canonical
curl -s http://localhost:3000/docs/getting-started/quickstart | grep -i canonical
```

**Expected output:**
```html
<link rel="canonical" href="https://docs.vellar.xyz/docs/getting-started/quickstart"/>
```

```bash
# Test 4: Special characters in slug are URL-encoded in canonical
curl -s http://localhost:3000/docs/some-page-with-spaces | grep -i canonical
```

**Expected:** Slug segments are URL-encoded in the canonical.

**Pass criteria:**
- Each page has exactly one canonical tag
- No page has multiple canonical tags
- Each canonical points to its own slug on `docs.vellar.xyz`
- URL encoding is correct for special characters

## 4. Markdown Route Headers Verification

### Test Markdown Route Headers

```bash
# Test 1: Check X-Robots-Tag header
curl -I http://localhost:3000/docs/getting-started/quickstart.md
```

**Expected output includes:**
```
X-Robots-Tag: noindex
Link: <https://docs.vellar.xyz/docs/getting-started/quickstart>; rel="canonical"
Content-Type: text/markdown; charset=utf-8
```

```bash
# Test 2: Multiple pages have correct headers
curl -I http://localhost:3000/docs/x402.md
```

**Expected output includes:**
```
X-Robots-Tag: noindex
Link: <https://docs.vellar.xyz/docs/x402>; rel="canonical"
```

```bash
# Test 3: Markdown content is still accessible
curl -s http://localhost:3000/docs/getting-started/quickstart.md | head -20
```

**Expected output:** First 20 lines of markdown content (not 404).

**Pass criteria:**
- Every markdown route returns 200 (not 404)
- X-Robots-Tag header is `noindex`
- Link header contains canonical URL
- Content-Type is `text/markdown; charset=utf-8`
- Markdown content is served correctly

## 5. robots.txt Verification

### Check robots.txt Content

```bash
curl http://localhost:3000/robots.txt
```

**Expected output:**
```
User-agent: *
Allow: /
Disallow: /md/

Sitemap: https://docs.vellar.xyz/sitemap.xml
```

**Pass criteria:**
- `Allow: /` is present (allows docs)
- `Disallow: /md/` is present (disallows markdown)
- Sitemap URL is listed
- No syntax errors

## 6. Metadata Consistency Check

### Verify Origin Is Consistent

All canonical URLs should use the same origin:

```bash
# Extract canonical URLs from multiple pages
for page in docs x402 getting-started/quickstart; do
  echo "=== /docs/$page ==="
  curl -s http://localhost:3000/docs/$page 2>/dev/null | grep -i canonical | sed 's/.*href="\([^"]*\)".*/\1/'
done
```

**Expected output:**
```
=== /docs ===
https://docs.vellar.xyz/docs

=== /docs/x402 ===
https://docs.vellar.xyz/docs/x402

=== /docs/getting-started/quickstart ===
https://docs.vellar.xyz/docs/getting-started/quickstart
```

**Pass criteria:** All URLs start with `https://docs.vellar.xyz`

## 7. No Duplicates Check

### Verify No Duplicate Canonical Tags

```bash
# Extract page and count canonical tags (should be exactly 1)
curl -s http://localhost:3000/docs/getting-started/quickstart 2>/dev/null | grep -i "rel=\"canonical\"" | wc -l
```

**Expected output:** `1`

Run this for multiple pages to ensure consistency.

**Pass criteria:** Every page has exactly 1 canonical tag, never 0 or 2+.

## 8. Build Output Verification

### Verify Static Page Count

After building, check the output directory:

```bash
# Linux/macOS
find .next/server/pages -type f -name "*.html" | wc -l

# Windows (PowerShell)
(Get-ChildItem -Recurse -Filter "*.html" .next/server/pages).Count
```

**Expected:** ~104 pages (docs index + 48 docs pages + 48 markdown routes + other routes)

**Pass criteria:** Consistent with build output.

## 9. Search Engine Simulation

### Simulate Search Engine Crawler

```bash
# Crawlers respect Disallow in robots.txt
curl -I -A "Googlebot" http://localhost:3000/md/x402
```

Should return 200 with headers (Googlebot may still fetch to verify noindex).

```bash
# Verify noindex header discourages indexing
curl -I http://localhost:3000/docs/x402.md | grep "X-Robots-Tag"
```

**Expected output:** `X-Robots-Tag: noindex`

**Pass criteria:**
- robots.txt Disallow is present
- X-Robots-Tag header is present
- Both signals are consistent

## Summary Checklist

- [ ] All 62+ tests pass
- [ ] Build succeeds with 104+ pages
- [ ] Canonical tags present on every docs page
- [ ] No page has multiple canonical tags
- [ ] Markdown route returns X-Robots-Tag: noindex
- [ ] Markdown route returns Link canonical header
- [ ] robots.txt includes Disallow: /md/
- [ ] robots.txt includes Sitemap URL
- [ ] Canonical origin is consistent across all pages
- [ ] Markdown content still accessible (no 404)

## Troubleshooting

**Canonical tags missing?**
- Check `metadataBase` is set in `layout.tsx`
- Verify `generateMetadata()` in `[...slug]/page.tsx` calls `getCanonicalUrl()`
- Ensure `CANONICAL_ORIGIN` is correctly set

**Markdown headers missing?**
- Verify headers are set in the Response constructor in `md/[...slug]/route.ts`
- Check header names are correct (case-sensitive)

**Tests failing?**
- Run `npm test -- --reporter=verbose` for detailed output
- Check imports in test files reference correct paths

**Build failing?**
- Run `npx tsc --noEmit` to check for TypeScript errors
- Review error messages and fix type mismatches

## Questions?

Refer to:
- `IMPLEMENTATION-STEPS.md` — Setup instructions
- `README.md` — Overview and design decisions
- `PR-DESCRIPTION.md` — Technical details and rationale
