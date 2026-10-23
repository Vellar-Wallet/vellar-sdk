# Public API Surface Diff Check (#686)

Reference implementation for a script that diffs the public export surface
of the currently published npm version against the current working tree's
build output, and flags any removal or signature change before publish.

## What It Does

- `extractExportSurface(dtsSource)` extracts every named export from a
  `.d.ts` file's text: renamed re-exports (`export { a as Foo } from
  '...'`), declared functions, consts, classes, interfaces, and type
  aliases, which together cover every export form actually present in this
  repo's bundled `dist/index.d.ts` (verified against the real published
  `vellar-sdk@0.6.2` package, see below).
- `diffExportSurfaces(before, after)` compares two surfaces into
  **added** / **removed** / **changed** / **unchanged** buckets.
- The CLI supports diffing two local files, or fetching the previously
  published version directly from npm via `--from-npm <package-name>`
  (uses `npm pack` + `tar`, no extra dependency).
- Exits non-zero when anything was removed or changed, so it can gate a
  release step.

## A note on what this diff can and can't see

This is a **named-export presence and rough-signature** diff, not a full
structural type diff. A re-export line in a bundled `dist/index.d.ts`
(`export { a as Foo } from './chunk.js'`) hides the real declaration
behind an opaque chunk reference, so this tool can only tell whether `Foo`
is still exported at all, not whether its structural shape changed. For
most of this SDK's exports (which are re-exports from internal chunks after
the tsup bundling step), **removal detection is solid; in-place signature
change detection is not** — a re-export is only ever "present" or "removed"
here, never "changed". For the directly-declared forms (`export declare
function`/`const`/`class`, `export interface`, `export type`), a basic
signature change (e.g. a function gaining a required parameter) is caught.
A genuinely complete structural diff would need a real TypeScript compiler
API pass rather than text extraction; that's a larger follow-up this
reference implementation deliberately doesn't attempt, since the issue's
core ask (catch a removal before it ships silently) is already covered.

## Verification (manually run, see note on CI below)

Ran the real script against the actual published `vellar-sdk@0.6.2`
package (via `npm pack`), diffed against itself:

```
Public export surface diff: 38 unchanged, 0 added, 0 removed, 0 changed.
```

Then against a deliberately modified copy (one export renamed/removed, one
added):

```
Public export surface diff: 37 unchanged, 2 added, 1 removed, 0 changed.

  + removedExportPlaceholder (re-export)
  + brandNewExportedFunction (function(a: string))
  - parseAmount (was re-export)

This diff includes a removed or changed export. Confirm it is documented in CHANGELOG.md as a breaking change before publishing.
```
exit code: 1, confirming the gate actually fires.

Unit test assertions (`api-surface-diff.test.ts`) all independently verified:

```
PASS renamed-reexport
PASS function-sig
PASS const-sig
PASS class-sig
PASS interface-sig
PASS type-sig
PASS no-changes-when-identical
PASS detects-added
PASS detects-removed
PASS detects-changed
PASS reexport-never-changed
ALL PASS
```

## Integration into Core

1. Copy `api-surface-diff.mjs` to `scripts/api-surface-diff.mjs` and
   `api-surface-diff.test.ts` to `scripts/api-surface-diff.test.ts`.
2. Add a root `package.json` script:
   ```json
   "check:api-surface": "node scripts/api-surface-diff.mjs --from-npm vellar-sdk dist/index.d.ts"
   ```
3. Add it to `prepublishOnly`, after `npm run build` so `dist/index.d.ts`
   exists:
   ```json
   "prepublishOnly": "npm run build && npm test && npm run check:browser && npm run verify:package && npm run check:api-surface"
   ```
4. For the CHANGELOG cross-reference the issue asks for: when the script
   exits non-zero (a removal or change was found), have it (or a thin
   wrapper around it) grep `CHANGELOG.md`'s latest unreleased entry for the
   word "breaking" (or whatever marker the project's changelog convention
   already uses) before failing, so an already-documented breaking change
   doesn't block a legitimate release, while an undocumented one still
   does.
5. Document the `--from-npm` flag and the "named-export presence, not full
   structural diff" caveat above in `CONTRIBUTING.md`'s release checklist.
