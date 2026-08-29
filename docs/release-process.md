# Release process: canary rollout for pre-1.0 releases

Maintainer-only. This is the process for cutting a release of `vellar-sdk`
while the package is pre-1.0 — see `CONTRIBUTING.md` rule 3 for why this
lives outside `contrib/` and is not something contributors run.

## Why a canary stage exists

Before this process, every tag pushed to this repo published straight to the
npm `latest` dist-tag — the tag every plain `npm install vellar-sdk` resolves
to. There was no way for an early-adopter consumer to try a release before it
became the default for everyone. Pre-1.0, the API can still shift in ways a
typecheck and the existing test suite don't fully exercise against a real
consumer app (a passkey ceremony, a live facilitator, a real backend
gateway) — a canary stage buys a validation window before a release is
default-installed.

## The two dist-tags

| dist-tag | Who gets it | Published by |
| -------- | ------------ | ------------ |
| `next`   | Nobody by default — only `npm install vellar-sdk@next`, or a consumer pinned to it | Pushing a tag with a semver **prerelease** suffix, e.g. `v0.7.0-canary.0` |
| `latest` | Everyone running plain `npm install vellar-sdk` | Pushing a plain version tag, e.g. `v0.7.0` — OR promoting an already-published canary (below) |

The decision is made by `scripts/npm-dist-tag-for.mjs` (unit-tested in
`scripts/npm-dist-tag-for.test.mjs`) and wired into `.github/workflows/publish.yml`
as the `Determine dist-tag (canary vs latest)` step. It reads the pushed git
tag: any `-` (semver prerelease marker) routes to `next`, anything else
routes to `latest`. Nothing else about the publish job changes — the same
`npm audit`, `typecheck`, `test`, `build`, and provenance-signed
`npm publish` steps run either way, so a canary gets exactly the same
supply-chain guarantees as a `latest` release (security audit V-8).

## Step by step: cutting a canary

1. Bump `package.json`'s `version` to a prerelease, e.g. `0.7.0-canary.0`.
   Use `npm version 0.7.0-canary.0 --no-git-tag-version` or edit by hand,
   then commit.
2. Push a matching tag: `git tag v0.7.0-canary.0 && git push origin v0.7.0-canary.0`.
   The tag MUST match `package.json`'s version exactly (`publish.yml`'s
   existing "Verify tag matches package version" step fails the job
   otherwise — unchanged by this process).
3. `publish.yml` runs, and — because the tag carries a prerelease suffix —
   publishes to npm under the `next` dist-tag. `npm install vellar-sdk`
   for ordinary consumers is completely unaffected; only
   `npm install vellar-sdk@next` (or `@0.7.0-canary.0` exactly) picks it up.
4. Announce the canary (Telegram, a GitHub Discussion/issue, whatever this
   project's current channel is) asking early adopters to validate it, and
   work through the checklist below before promoting.

## Consumer validation checklist (before promoting)

Do not promote a canary to `latest` until every box below is checked, or the
box is marked N/A with a reason recorded in the promotion PR/issue:

- [ ] At least one real consumer app (not just this repo's own test suite)
      has installed `vellar-sdk@next` and exercised the paved-road path:
      `createVellarWallet` construction, `create()`/`connect()` against a
      real passkey, and `pay()` against a real backend + facilitator on
      testnet.
- [ ] If this release touches `x402`: at least one real x402 payment (agent
      or passkey signer) has settled against a real facilitator on testnet.
- [ ] If this release touches `policies` or `agents`: at least one real
      policy attach/deploy or agent key mint/revoke has been exercised
      against a real backend.
- [ ] No new consumer-facing error has been reported that isn't already a
      known, intentional behavior change called out in `CHANGELOG.md`.
- [ ] `CHANGELOG.md` has an entry for this version (written as if it were
      going to `latest` — the canary and the eventual `latest` promotion are
      the same artifact and the same changelog entry, not two).
- [ ] The canary has been live on `next` for a deliberate minimum window
      (a few days, not minutes) so early adopters have had a real chance to
      pick it up — promoting immediately after publishing defeats the point
      of the stage.

## Step by step: promoting canary to latest

Once the checklist above is satisfied:

1. Decide the version consumers on `latest` should actually see. Two valid
   options:
   - **Promote the canary version as-is** (e.g. `0.7.0-canary.0` becomes
     `latest`) — fastest, but an unusual-looking version number for
     `latest` to carry.
   - **Re-tag as a plain release** (e.g. cut `v0.7.0` from the same commit
     the canary was built from, bump `package.json`, and let `publish.yml`
     publish it fresh to `latest` under the normal path) — cleaner version
     history, costs one more publish run of an already-validated artifact.

   Most releases should use the second option; the promotion workflow
   below exists for the first, and for recovering a mid-validation "we
   actually just want what's on `next` right now" promotion.

2. Run the **Promote canary to latest** workflow
   (`.github/workflows/promote-canary.yml`) from the Actions tab, or:

   ```sh
   gh workflow run promote-canary.yml -f version=0.7.0-canary.0
   ```

   This does not build or publish a new tarball — it points the `latest`
   dist-tag at a version already on the registry, so what consumers get is
   byte-for-byte what was validated as the canary. It first checks the
   version is actually published (fails loudly instead of silently
   no-op'ing on a typo), runs `npm dist-tag add`, then confirms with
   `npm dist-tag ls`.

3. Verify: `npm view vellar-sdk dist-tags` should show `latest` pointing at
   the promoted version.

## Testing this process end to end

Because this touches real npm publishes, it is not something CI exercises
automatically against the real registry on every PR. Before relying on it
for a real release, a maintainer runs the full loop once, deliberately:

1. Cut a real canary (`v0.0.0-canary-test.0` off a throwaway commit, or the
   next real prerelease when one is due) and confirm on npmjs.com / `npm
   view vellar-sdk dist-tags` that it landed under `next`, not `latest`.
2. Confirm `npm install vellar-sdk` (no tag) in a scratch project still
   resolves to the previous `latest` version — i.e. publishing a canary
   provably did not move `latest`.
3. Run `promote-canary.yml` against that version and confirm `latest` now
   points at it (`npm view vellar-sdk dist-tags`).
4. Confirm `npm install vellar-sdk` in a fresh scratch project now resolves
   to the promoted version.

Record the outcome (date, versions used, who ran it) in the release PR or
tracking issue for the release that exercised it, so there's a paper trail
that the flow was actually run end to end rather than only reasoned about.
