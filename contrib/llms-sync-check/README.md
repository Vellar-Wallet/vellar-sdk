# LLMS Sync CI Check

**Status:** Ready for implementation in root `scripts/`

This directory contains reference implementation files that should be moved to `scripts/` at root level as part of the fix for #587.

## Problem

`website/app/llms.txt/route.ts` and `website/app/llms-full.txt/route.ts` generate content from `website/content/docs/` at request time, but nothing in CI validates that:

1. Every page in `DOC_PAGES` registry is included in `llms-full.txt`
2. Every slug referenced in `llms.txt` actually exists in the registry
3. No orphaned slugs are present in either output

This can lead to:
- Missing documentation in the full corpus served to AI agents
- Broken links in the index
- Dead page references lingering after docs are removed

## Solution

Create a CI check script that:

1. **Renders both routes** — Call `buildLlmsIndex()` and `buildLlmsFull()` from `website/lib/docs-agent.ts`
2. **Extracts slugs** — Parse the generated outputs to find all page references:
   - From `llms.txt`: Extract slugs from links like `[Title](https://docs.vellar.xyz/docs/{slug}.md)`
   - From `llms-full.txt`: Extract slugs from source markers like `<!-- Source: https://docs.vellar.xyz/docs/{slug} -->`
3. **Compares against registry** — Check that slug sets match `DOC_PAGES` from `website/lib/docs-registry.ts`
4. **Reports errors** — Fail CI with clear messages for:
   - Missing pages: `"page X in registry but missing from llms-full.txt"`
   - Invalid slugs: `"slug Y in llms.txt but not in registry"`
   - Incomplete index: `"page Z in registry but missing from llms.txt"`

## Implementation Steps

### 1. Copy files to root `scripts/` directory

```bash
cp contrib/llms-sync-check/check-llms-sync.mjs scripts/
cp contrib/llms-sync-check/check-llms-sync.test.ts scripts/
```

The import paths are already correct for the root `scripts/` location.

### 2. Add to `package.json` scripts

Add to the `"scripts"` section:
```json
"check:llms-sync": "node scripts/check-llms-sync.mjs"
```

### 3. Integrate into CI pipeline

Edit `.github/workflows/ci.yml` and add after `check:docs`:

```yaml
# llms.txt and llms-full.txt must stay in sync with the docs registry.
- run: npm run check:llms-sync
```

Full section should be:
```yaml
- run: npm run typecheck
# Docs snippets typecheck against the current source — a quickstart that
# drifts from the real API fails the PR that introduces the drift.
- run: npm run check:docs
# llms.txt and llms-full.txt must stay in sync with the docs registry.
- run: npm run check:llms-sync
- run: npm test
```

## File Reference

### `check-llms-sync.mjs`

- Node.js script (ES modules) following the pattern of `scripts/check-doc-snippets.mjs`
- Exports `validateLlmsSync()` function for unit testing
- Handles nested section slugs (e.g., `"getting-started/introduction"`)
- Provides clear error messages with actionable guidance
- Exit code: 0 on success, 1 on validation failure

### `check-llms-sync.test.ts`

- Unit tests using vitest (matching existing test style)
- Mocks `buildLlmsIndex()`, `buildLlmsFull()`, and `DOC_PAGES`
- Covers:
  - ✅ Happy path (all pages in sync)
  - ✅ Missing page from corpus
  - ✅ Invalid slug in index
  - ✅ Missing page from index
  - ✅ Multiple simultaneous errors
  - ✅ Nested section slug extraction
  - ✅ Deeply nested slugs (e.g., `section/subsection/page`)

## Related Files in Repo

- `website/lib/docs-agent.ts` — `buildLlmsIndex()`, `buildLlmsFull()`
- `website/lib/docs-registry.ts` — `DOC_PAGES` registry (single source of truth)
- `.github/workflows/ci.yml` — CI pipeline configuration
- `scripts/check-doc-snippets.mjs` — Similar CI check pattern for code snippet drift

## Acceptance Criteria

- ✅ Files moved to `scripts/` at root level
- ✅ Package.json script added
- ✅ CI pipeline integration added
- ✅ Implementation validates all three failure modes
- ✅ Unit tests passing in CI
- ✅ PR targets dev branch
- ✅ Reviewed and approved by maintainer before merge

## PR Description Template

```
Add CI check for llms.txt and llms-full.txt sync

Ensures that `llms.txt` and `llms-full.txt` stay in sync with the documentation registry (`DOC_PAGES`). The check runs on every PR and push, catching:

- Pages missing from `llms-full.txt` that exist in the registry
- Invalid/orphaned slugs referenced in `llms.txt`
- Pages in the registry missing from `llms.txt`

**Changes:**
- Add `scripts/check-llms-sync.mjs` — validation script with clear error messages
- Add `scripts/check-llms-sync.test.ts` — unit tests for all failure modes
- Add `check:llms-sync` npm script to package.json
- Integrate into CI after `check:docs`

**Testing:**
Unit tests cover happy path, missing pages, invalid slugs, and nested sections. Integration testing happens in CI on every PR/push.

Fixes #587
```
