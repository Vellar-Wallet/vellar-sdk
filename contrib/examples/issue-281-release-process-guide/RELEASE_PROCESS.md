# Release process stages

Closes #281.

Contributor changes are confined to `contrib/`, so this doc lives here as a
reference rather than editing `CONTRIBUTING.md` directly — a maintainer can
fold this content into `CONTRIBUTING.md` verbatim once reviewed. It
describes, stage by stage, how a change lands in `main` and ends up
published to npm, based on the workflows actually defined in
`.github/workflows/`.

## Overview

```
PR merged to dev/drips
        |
        v
  maintainer promotes to main  (manual)
        |
        v
  verify-merged.yml            (automated — post-merge content check)
        |
        v
  version bump + CHANGELOG.md  (manual)
        |
        v
  git tag vX.Y.Z + push        (manual)
        |
        v
  publish.yml                  (automated — build, verify, npm publish)
```

## Stage 1 — Versioning (manual)

The package version lives in `package.json` (`"version": "0.6.1"` as of this
writing). A maintainer bumps it by hand as part of preparing a release —
following semver: patch for fixes, minor for additive features, major for
breaking changes. This repo does not use an automated version-bump bot; the
number in `package.json` is the source of truth and is checked against the
release tag at publish time (see Stage 3).

## Stage 2 — Changelog (manual)

`CHANGELOG.md` gets a new top-level entry (`## X.Y.Z — YYYY-MM-DD`)
summarizing what changed, written for someone deciding whether to upgrade —
see the existing `0.6.0` entry for the level of detail expected on a
breaking or security-relevant change (it explains the vulnerability, the
threat model, and what wasn't affected). This is a manual, human-written
step; there is no changelog-generation tooling in this repo today.

## Stage 3 — Build and verify (automated)

Two workflows do the automated verification work, at different points:

- **[`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)** runs
  on every push to `main`/`drips` and on every pull request:
  `npm ci` → `npm run typecheck` → `npm test` → `npm run build`. This is the
  gate every PR must pass before merge, and it's the same sequence
  `CONTRIBUTING.md` already asks contributors to run locally before opening
  a PR.

- **[`.github/workflows/verify-merged.yml`](../../../.github/workflows/verify-merged.yml)**
  runs after every push to `main` and re-verifies, *by content* rather than
  by merge status, that each PR referenced in the new commits actually
  landed. This exists because merge status alone was once misleading: two
  PRs both reported "merged" on the same day, but one was stacked on a base
  that had merged moments earlier and its content never actually reached
  `main`. The workflow greps merged commit messages for `#<number>`, then
  runs `scripts/verify-merged.mjs` against each one, including a
  self-test step that asserts the known-bad case still fails — so a
  regression in the checker itself doesn't silently start passing everything.

Both are fully automated; no manual step is required to trigger them.

## Stage 4 — Publish (automated, tag-triggered)

**[`.github/workflows/publish.yml`](../../../.github/workflows/publish.yml)**
runs only when a `v*` tag is pushed — never on an ordinary commit to `main`.
A maintainer creates the release by tagging manually
(`git tag v0.6.2 && git push origin v0.6.2`); everything downstream of that
tag push is automated:

1. Checkout, install, `npm audit --audit-level=high`, typecheck, test, build
   — the same gates as CI, run again independently rather than trusted from
   the earlier PR run.
2. **Tag/version match check** — the workflow reads `package.json`'s
   `version` and compares it against the pushed tag (`v0.6.2` must match
   `0.6.2`). A mismatch fails the workflow before anything is published,
   so a forgotten version bump can't ship under the wrong tag.
3. `npm publish --provenance --access public` — publishes with npm
   provenance, which cryptographically attests the published tarball back
   to this exact workflow run and commit. This matters here specifically:
   a compromised publish would run inside every consuming app's browser and
   inside any MCP server holding a signing key, so every release needs to
   be traceable to a specific, auditable build.

The `id-token: write` permission on this job is what allows minting the
OIDC token npm exchanges for that provenance attestation — it's scoped to
the publish job only.

## What's automated vs. manual, at a glance

| Stage | Trigger | Automated? |
| --- | --- | --- |
| Version bump in `package.json` | maintainer decision | Manual |
| `CHANGELOG.md` entry | maintainer writes it | Manual |
| Typecheck / test / build on every PR | push / PR event | Automated (`ci.yml`) |
| Post-merge content verification | push to `main` | Automated (`verify-merged.yml`) |
| Git tag creation | maintainer decision | Manual |
| Build, audit, tag/version match check, npm publish | tag push (`v*`) | Automated (`publish.yml`) |

## Notes for a first-time contributor

- You will never run the publish stage yourself — it's gated to tag pushes,
  and only a maintainer with `NPM_TOKEN` access can complete it.
- The check you *can* run locally before opening a PR is the same one CI
  runs: `npm install && npm run typecheck && npm test && npm run build`
  (already documented in `CONTRIBUTING.md`).
- If your PR doesn't touch `package.json`'s version or `CHANGELOG.md`,
  that's normal — those are release-time steps a maintainer handles when
  cutting an actual version, not something every PR needs to include.
