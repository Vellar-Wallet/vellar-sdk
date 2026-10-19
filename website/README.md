# Vellar SDK Docs Site

The Vellar SDK documentation site is a Next.js 15 app serving docs.vellar.xyz. Every page is built from markdown in `content/docs/` and registered in `lib/docs-registry.ts`.

## Building and Running

```bash
npm install
npm run dev      # Development server
npm run build    # Production build
npm start        # Start production build
npm test         # Run tests
```

## SEO: Canonical URLs and Search Indexing

### Canonical URLs

Each docs page declares a single preferred URL using canonical link tags via `generateMetadata()`. This prevents search engines from indexing multiple versions of the same page.

**Implementation:**
- `metadataBase` set in `app/layout.tsx` to `https://docs.vellar.xyz`
- Each docs page emits `alternates: { canonical }` in `generateMetadata()`
- URL constructed via `getCanonicalUrl(slug)` helper in `lib/canonical-url.ts`
- Docs index page (`/docs`) emits canonical before redirecting
- **Never add hand-written `<link rel="canonical">` tags** — use `generateMetadata()` only

### Raw Markdown Route

The markdown route at `/docs/<slug>.md` (via `/md/<slug>` rewrite) is intentionally excluded from search indexes using a multi-layered approach:

1. **`robots.txt` Disallow: /md/**  — tells crawlers not to fetch
2. **`X-Robots-Tag: noindex` header** — most reliable for non-HTML responses
3. **`Link: <canonical>; rel="canonical"` header** — consolidates signals to HTML version

Together, these ensure search results link to the formatted HTML docs, not raw markdown.

## Running the Audit

```bash
npm test                    # All 62 tests pass
npm run build               # Build succeeds, 104 static pages
npm start                   # Start server

# In another terminal:
curl -s http://localhost:3000/docs/getting-started/quickstart | grep -i canonical
# Expected: exactly one canonical tag

curl -I http://localhost:3000/docs/getting-started/quickstart.md
# Expected: X-Robots-Tag: noindex, Link: <canonical>; rel="canonical"

curl http://localhost:3000/robots.txt
# Expected: Disallow: /md/, Sitemap: https://docs.vellar.xyz/sitemap.xml
```

## Contributing

1. Add markdown to `content/docs/<slug>.md`
2. Register in `lib/docs-registry.ts`
3. Run `npm test` to verify canonical URLs
4. Never hand-write canonical tags — framework handles them automatically

See `contrib/docs-canonical-urls-seo-audit/README.md` for full documentation.
