# Code Snippets — Integration Examples

Use these snippets as a reference when integrating the implementation into `website/`.

## 1. `website/app/layout.tsx` — Add metadataBase

**Add this import:**
```typescript
import { CANONICAL_ORIGIN } from "@/lib/canonical-url";
```

**Update the metadata export:**
```typescript
export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN),
  title: {
    template: "%s | Documentation",
    default: "Documentation",
  },
  // ... rest of existing metadata
};
```

**Why:** Ensures all child pages resolve relative canonical URLs to the correct origin.

---

## 2. `website/app/docs/page.tsx` — Add canonical for index

**Add this import:**
```typescript
import { CANONICAL_ORIGIN } from "@/lib/canonical-url";
```

**Add metadata export:**
```typescript
export const metadata: Metadata = {
  title: "Documentation",
  description: "API reference and guides for Vellar.",
  alternates: {
    canonical: `${CANONICAL_ORIGIN}/docs`,
  },
};

export default function DocsPage() {
  // existing implementation
}
```

**Why:** The `/docs` index page redirects; we want it to have a canonical before redirecting.

---

## 3. `website/app/docs/[...slug]/page.tsx` — Update generateMetadata

**Add this import:**
```typescript
import { getCanonicalUrl } from "@/lib/canonical-url";
```

**Update generateMetadata:**
```typescript
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
    // ... rest of existing metadata
  };
}
```

**Why:** Uses `getCanonicalUrl()` to emit canonical for each page via Metadata API. Next.js handles deduplication.

---

## 4. `website/app/md/[...slug]/route.ts` — Add indexing headers

**Add this import:**
```typescript
import { getCanonicalUrl } from "@/lib/canonical-url";
```

**Update the GET handler:**
```typescript
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

**Headers explained:**
- `X-Robots-Tag: noindex` — Tells crawlers not to index this response
- `Link: <canonical>; rel="canonical"` — Points to the authoritative HTML page
- Content-Type remains `text/markdown` — Markdown still accessible for AI tools

---

## 5. `website/app/robots.txt/route.ts` — Add Disallow rule

**Full robots.txt route with Disallow:**
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

**Explanation:**
- `User-agent: *` — Applies to all crawlers
- `Allow: /` — Allows general crawling (default behavior, can be omitted)
- `Disallow: /md/` — Prevents crawlers from fetching markdown route
- `Sitemap:` — Points to sitemap for discovery

---

## 6. File Locations Reference

**Copy source files from contrib:**
```
contrib/docs-canonical-urls-seo-audit/
├── lib-canonical-url.ts                → website/lib/canonical-url.ts
├── lib-canonical-url.test.ts           → website/lib/canonical-url.test.ts
├── lib-canonical-url-audit.test.ts     → website/lib/canonical-url-audit.test.ts
└── lib-markdown-route.test.ts          → website/lib/markdown-route.test.ts
```

**Update these existing files:**
```
website/
├── app/
│   ├── layout.tsx                       (update: add metadataBase)
│   ├── docs/
│   │   ├── page.tsx                     (update: add metadata export)
│   │   └── [...slug]/
│   │       └── page.tsx                 (update: generateMetadata)
│   ├── md/
│   │   └── [...slug]/
│   │       └── route.ts                 (update: add headers)
│   └── robots.txt/
│       └── route.ts                     (update: add Disallow)
└── README.md                            (optional: add SEO documentation)
```

---

## 7. Import Paths Cheat Sheet

**From `website/lib/canonical-url.ts`:**
```typescript
import { CANONICAL_ORIGIN, getCanonicalUrl } from "@/lib/canonical-url";
```

**In app files:**
- `app/layout.tsx` imports `CANONICAL_ORIGIN`
- `app/docs/page.tsx` imports `CANONICAL_ORIGIN`
- `app/docs/[...slug]/page.tsx` imports `getCanonicalUrl`
- `app/md/[...slug]/route.ts` imports `getCanonicalUrl`

---

## 8. Common Patterns

### Pattern: Using getCanonicalUrl in tests
```typescript
import { getCanonicalUrl } from "@/lib/canonical-url";

const url = getCanonicalUrl("getting-started/quickstart");
// Returns: "https://docs.vellar.xyz/docs/getting-started/quickstart"
```

### Pattern: Setting response headers
```typescript
return new Response(content, {
  status: 200,
  headers: {
    "Content-Type": "text/markdown; charset=utf-8",
    "X-Robots-Tag": "noindex",
    "Link": `<${canonical}>; rel="canonical"`,
  },
});
```

### Pattern: Metadata with canonical
```typescript
const metadata: Metadata = {
  title: page.title,
  description: page.description,
  alternates: {
    canonical: getCanonicalUrl(slug),
  },
};
```

---

## 9. Testing Your Changes

After making the changes, verify:

```bash
# Run tests (should pass)
npm test

# Build (should succeed)
npm run build

# Check canonical tags
npm start  # in another terminal
curl -s http://localhost:3000/docs/x402 | grep canonical

# Check markdown headers
curl -I http://localhost:3000/docs/x402.md
```

---

## 10. Troubleshooting Snippets

### Check TypeScript compilation
```bash
npx tsc --noEmit
```

### Check if canonical is being set
```typescript
// In page.tsx generateMetadata
console.log("Canonical:", getCanonicalUrl(pageSlug));

export async function generateMetadata(...) {
  return {
    alternates: {
      canonical: getCanonicalUrl(pageSlug),
    },
  };
}
```

### Verify headers are set correctly
```typescript
// In route.ts GET handler
console.log("Headers:", {
  "X-Robots-Tag": "noindex",
  "Link": `<${canonical}>; rel="canonical"`,
});

return new Response(content, {
  headers: {
    "X-Robots-Tag": "noindex",
    "Link": `<${canonical}>; rel="canonical"`,
  },
});
```

### Extract canonical from HTML
```bash
# Full extraction
curl -s http://localhost:3000/docs/x402 | grep -oP 'href="\K[^"]*(?=.*canonical)'

# Count canonical tags (should be 1)
curl -s http://localhost:3000/docs/x402 | grep -c "rel=\"canonical\""
```

---

## 11. Configuration Reference

### CANONICAL_ORIGIN

**File:** `website/lib/canonical-url.ts`

```typescript
export const CANONICAL_ORIGIN = "https://docs.vellar.xyz";
```

**To change domain in the future:**
1. Edit this one constant
2. All canonical URLs update automatically
3. No other changes needed

---

## 12. Header Format Reference

### X-Robots-Tag Header
```
X-Robots-Tag: noindex
```

Tells crawlers: "Don't index this page"

### Link Header (RFC 5988)
```
Link: <https://docs.vellar.xyz/docs/x402>; rel="canonical"
```

Format: `Link: <URL>; rel="canonical"`

Always include in angle brackets: `<URL>`

### Content-Type Header
```
Content-Type: text/markdown; charset=utf-8
```

For markdown responses. Matches file extension `.md`.

---

## Complete Integration Order

1. Copy `lib-canonical-url.ts` to `website/lib/`
2. Copy test files to `website/lib/`
3. Update `website/app/layout.tsx` (add metadataBase)
4. Update `website/app/docs/page.tsx` (add metadata)
5. Update `website/app/docs/[...slug]/page.tsx` (update generateMetadata)
6. Update `website/app/md/[...slug]/route.ts` (add headers)
7. Update `website/app/robots.txt/route.ts` (add Disallow)
8. Run `npm test` → verify 62+ tests pass
9. Run `npm run build` → verify 104+ pages
10. Test with curl → verify canonical tags and headers
11. Create PR
