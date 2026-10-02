# Rollback Guidance for Broken Published SDK Versions

When a published SDK version turns out to be broken after release, follow this
procedure to minimize disruption for consumers.

## 1. Deprecate the broken version on npm

Mark the broken version as deprecated so `npm install` warns consumers:

```sh
npm deprecate vellar-sdk@<broken-version> "This version is broken — upgrade to <fixed-version>"
```

Replace `<broken-version>` with the exact semver (e.g. `0.7.0`) and
`<fixed-version>` with the next patch release (e.g. `0.7.1`).

## 2. Fast-follow with a patch release

1. Fix the issue on a branch off `dev`.
2. Bump the patch version in `package.json` (e.g. `0.7.0` → `0.7.1`).
3. Update `CHANGELOG.md` with the fix (see step 3 below).
4. Open a PR targeting `dev`, get it reviewed and merged.
5. A maintainer cuts the release from `main` as usual.

**Do not unpublish the broken version** — consumers may already have it cached
in lockfiles, and unpublishing creates a supply-chain gap.

## 3. Notify consumers via CHANGELOG.md

Add an entry at the top of `CHANGELOG.md` in the new release section:

```markdown
## X.Y.Z — YYYY-MM-DD

**Hotfix for X.Y.W.** That version contained <brief description of the bug>.
Upgrade to this release to get the fix.

### What changed

- <one-line description of the fix>

### Migration

No breaking changes. Replace `vellar-sdk@X.Y.W` with `vellar-sdk@X.Y.Z` in
your dependencies.
```

Keep the entry concise — consumers scanning the changelog need to know three
things: what was broken, what's fixed, and whether migration is required.

## 4. Communicate beyond the changelog

- Post in the [Telegram group](https://t.me/+RWPCKXXJTj45Njk0) with a link to
  the changelog entry.
- If the break is security-critical, open a GitHub Advisory and follow the
  security disclosure process.

## Quick reference

| Step | Command / Action |
|------|-----------------|
| Deprecate | `npm deprecate vellar-sdk@X.Y.W "..."` |
| Fix | Branch off `dev`, patch, PR, merge |
| Release | Bump version, update CHANGELOG, maintainer cuts release |
| Notify | Telegram post + changelog entry |
