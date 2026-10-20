# Implementation Steps — Canonical URLs and SEO Audit

This guide walks maintainers through integrating the reference implementation into `website/`.

## Prerequisites

- Node.js 18+
- `cd website/` and `npm install` already run
- Familiar with Next.js metadata API and route handlers

## Step 1: Copy the Canonical URL Helper

**Source:** `lib-canonical-url.ts`  
**Destination:** `website/lib/canonical-url.ts`

Copy the file as-is. No modifications needed.

This file exports:
- `CANONICAL_ORIGIN = "https://docs.vellar.xyz"` — centralized origin
- `getCanonicalUrl(slug)` — constructs canonical URLs safely

## Step 2: Copy Test Files

**Sources:**
- `lib-canonical-url.test.ts`
- `lib-canonical-url-audit.test.ts`
- `lib-markdown-route.test.ts`

**Destination:** `website/lib/` (same directory)

Copy all three files as-is. They integrate with the existing `website/` test setup via Vitest.

## Step 3: Update `website/app/layout.tsx`

Add canonical origin to metadata:

```typescript
import { CANONICAL_ORIGIN } from "@/lib/canonical-url";

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN),
  // ... existing metadata
};
```

**What this does:**
- Sets the base origin for all relative canonical URLs
- Next.js uses this to resolve canonicals from child pages
- Single source of truth for the origin

## Step 4: Update `website/app/docs/page.tsx`

Add metadata export for the docs index page:

```typescript
import { CANONICAL_ORIGIN } from "@/lib/canonical-url";

export const metadata: Metadata = {
  title: "Documentation",
  description: "...",
  alternates: {
    canonical: `${CANONICAL_ORIGIN}/docs`,
  },
};

export default function DocsPage() {
  // existing implementation
}
```

**Why:**
- The `/docs` index page redirects; we want the index itself to have a canonical
- Prevents search engines from indexing the redirect target as a duplicate

## Step 5: Update `website/app/docs/[...slug]/page.tsx`

Update `generateMetadata()` to emit canonical:

```typescript
import { getCanonicalUrl } from "@/lib/canonical-url";

export async function generateMetadata({
  params,
}: {
  params: { slug: string[] };
}): Promise<Metadata> {
  const pageSlug = params.slug.join("/");
  const page = getDocPage(pageSlug);
  if (!page) {
    return {};
  }

  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: getCanonicalUrl(pageSlug),
    },
    // ... existing metadata
  };
}
```

**What this does:**
- Calls `getCanonicalUrl(slug)` for each page
- Next.js combines this with `metadataBase` to render canonical tag
- No hand-written `<link>` tags — uses Metadata API only

## Step 6: Update `website/app/md/[...slug]/route.ts`

Add headers to prevent markdown from being indexed:

```typescript
import { getCanonicalUrl } from "@/lib/canonical-url";

export async function GET(
  request: Request,
  { params }: { params: { slug: string[] } }
) {
  const slug = params.slug.join("/");
  const page = getDocPage(slug);
  if (!page) {
    return new Response("Not found", { status: 404 });
  }

  const canonical = getCanonicalUrl(slug);

  return new Response(page.markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Link": `<${canonical}>; rel="canonical"`,
    },
  });
}
```

**What this does:**
- `X-Robots-Tag: noindex` — tells crawlers not to index this response
- `Link: <canonical>` — signals the authoritative HTML page
- Keeps content available for AI tools, but out of search indexes

## Step 7: Update `website/app/robots.txt/route.ts`

Add `Disallow: /md/` rule:

```typescript
export async function GET() {
  const robotsTxt = `User-agent: *
Allow: /
Disallow: /md/

Sitemap: https://docs.vellar.xyz/sitemap.xml
`;

  return new Response(robotsTxt, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
```

**Why three-part strategy:**
1. **Disallow: /md/** in robots.txt → tells crawlers not to fetch
2. **X-Robots-Tag: noindex** in response header → prevents indexing if fetched
3. **Link: <canonical>** in response header → consolidates to HTML version

## Step 8: Run Tests

```bash
cd website
npm test
```

**Expected output:**
```
✓ canonical-url.test.ts (7 tests)
✓ canonical-url-audit.test.ts (5 tests)
✓ markdown-route.test.ts (6 tests)
✓ existing docs-agent tests (14 tests)
━━━━━━━━━━━━━━━━━━━━
62+ tests passing
```

All tests should pass without modifications.

## Step 9: Build and Verify

```bash
npm run build
```

**Expected output:**
```
✓ Build successful
✓ 104 static pages generated
✓ No TypeScript errors
```

## Step 10: HTML-Level Verification

Start the dev server:

```bash
npm start
```

In another terminal, verify canonical tags:

```bash
# Check a docs page has exactly one canonical
curl -s http://localhost:3000/docs/getting-started/quickstart | grep -i canonical
# Expected: <link rel="canonical" href="https://docs.vellar.xyz/docs/getting-started/quickstart"/>

# Check markdown route headers
curl -I http://localhost:3000/docs/getting-started/quickstart.md
# Expected:
#   X-Robots-Tag: noindex
#   Link: <https://docs.vellar.xyz/docs/getting-started/quickstart>; rel="canonical"
#   Content-Type: text/markdown; charset=utf-8

# Check robots.txt
curl http://localhost:3000/robots.txt
# Expected: includes "Disallow: /md/" and "Sitemap: https://docs.vellar.xyz/sitemap.xml"
```

All checks should pass.

## Step 11: Create PR

Use the template in `PR-DESCRIPTION.md` to create a GitHub PR:
- Target: `dev` branch
- Title: "feat(website): add canonical URLs and SEO audit for docs (#595)"
- Copy the description from `PR-DESCRIPTION.md`

## Checklist

- [ ] Copied `lib-canonical-url.ts` to `website/lib/`
- [ ] Copied test files to `website/lib/`
- [ ] Updated `website/app/layout.tsx` with metadataBase
- [ ] Updated `website/app/docs/page.tsx` with canonical metadata
- [ ] Updated `website/app/docs/[...slug]/page.tsx` with generateMetadata
- [ ] Updated `website/app/md/[...slug]/route.ts` with headers
- [ ] Updated `website/app/robots.txt/route.ts` with Disallow
- [ ] `npm test` passes (62+ tests)
- [ ] `npm run build` succeeds (104+ pages)
- [ ] curl verification passes (canonical tags, headers, robots.txt)
- [ ] PR created targeting `dev`

## Troubleshooting

**Tests fail?**
- Verify `lib-canonical-url.ts` was copied correctly
- Check that test files import from the right paths
- Ensure `getDocPage()` and `DOC_PAGES` are exported from `docs-registry.ts`

**Build fails?**
- Check for TypeScript errors: `npx tsc --noEmit`
- Verify imports in updated app files

**Canonical tag missing?**
- Check `generateMetadata()` is called for the page
- Verify `metadataBase` is set in `layout.tsx`
- Inspect HTML source (not rendered DOM)

**Markdown headers missing?**
- Verify headers are set before `new Response()` is returned
- Check response Content-Type is `text/markdown`

## Questions?

Refer to:
- `README.md` — Overview and design decisions
- `VERIFICATION-GUIDE.md` — Detailed verification steps
- `PR-DESCRIPTION.md` — Complete PR template with rationale
