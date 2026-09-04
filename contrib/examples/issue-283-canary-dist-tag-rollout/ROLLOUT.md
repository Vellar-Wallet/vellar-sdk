# Canary npm dist-tag rollout for pre-1.0 releases

The proposed release process for issue
[#283](https://github.com/Vellar-Wallet/vellar-sdk/issues/283), including the
workflow changes it needs and the consumer-validation checklist that gates a
promotion.

## Why a canary stage

`.github/workflows/publish.yml` currently runs:

```sh
npm publish --provenance --access public
```

with no `--tag`, so every tag pushed publishes straight to the `latest`
dist-tag — the one every plain `npm install vellar-sdk` resolves to. There is
no stage in which an early-adopter consumer can try a release before it
becomes the default for everyone.

Pre-1.0 the API can still shift in ways a typecheck and the existing suite
don't fully exercise against a real consumer app (a passkey ceremony, a live
facilitator, a real backend gateway). A canary stage buys a validation window
before a release is default-installed.

## The two dist-tags

| dist-tag | Who gets it | Published by |
| -------- | ----------- | ------------ |
| `next` | Nobody by default — only `npm install vellar-sdk@next`, or a consumer pinned to it | A tag with a semver **prerelease** suffix, e.g. `v0.7.0-canary.0` |
| `latest` | Everyone running plain `npm install vellar-sdk` | A plain version tag, e.g. `v0.7.0` — or promoting an already-published canary |

The decision is `distTagFor()` in `canary-dist-tag-rollout.ts`: any `-`
(semver prerelease marker) routes to `next`, anything else to `latest`.

## Workflow change

Add a step to `publish.yml` before the publish, and pass its result to
`npm publish --tag`:

```yaml
      - name: Determine dist-tag (canary vs latest)
        id: dist_tag
        run: |
          DIST_TAG="$(node scripts/npm-dist-tag-for.mjs "$GITHUB_REF_NAME")"
          echo "dist-tag: $DIST_TAG"
          echo "tag=$DIST_TAG" >> "$GITHUB_OUTPUT"

      - run: npm publish --provenance --access public --tag "${{ steps.dist_tag.outputs.tag }}"
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Every other gate — `npm audit`, `typecheck`, `test`, `build`, provenance —
stays exactly as it is and runs identically for a canary or a release, so a
canary carries the same supply-chain guarantees as `latest` (security audit
V-8). The existing "Verify tag matches package version" step is unchanged and
still applies.

Promotion is a **separate, manual-dispatch-only** workflow, because promoting
is a maintainer decision made after real consumer validation, never an
automatic follow-on to publishing:

```yaml
name: Promote canary to latest
on:
  workflow_dispatch:
    inputs:
      version:
        description: "Version already published to npm (e.g. 0.7.0-canary.0)"
        required: true
        type: string

jobs:
  promote:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - name: Verify the version exists on the registry
        run: |
          if ! npm view "vellar-sdk@${{ inputs.version }}" version >/dev/null 2>&1; then
            echo "vellar-sdk@${{ inputs.version }} is not published — nothing to promote"
            exit 1
          fi
      - name: Promote to latest
        run: npm dist-tag add "vellar-sdk@${{ inputs.version }}" latest
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - run: npm dist-tag ls vellar-sdk
```

This does not build or publish a new tarball — it moves `latest` to point at a
version already on the registry, so what consumers get is byte-for-byte what
was validated as the canary.

## Cutting a canary

1. Bump `package.json`'s `version` to a prerelease, e.g. `0.7.0-canary.0`
   (`npm version 0.7.0-canary.0 --no-git-tag-version`), and commit.
2. Push a matching tag: `git tag v0.7.0-canary.0 && git push origin v0.7.0-canary.0`.
   The tag must match `package.json` exactly — the existing verify step fails
   the job otherwise.
3. `publish.yml` publishes it under `next`. Plain `npm install vellar-sdk` is
   unaffected.
4. Announce the canary and work the checklist below before promoting.

## Consumer validation checklist

Do not promote until every box is checked, or marked N/A with a reason
recorded on the promotion issue/PR:

- [ ] At least one **real consumer app** (not just this repo's suite) has
      installed `vellar-sdk@next` and exercised the paved-road path:
      `createVellarWallet`, `create()`/`connect()` against a real passkey, and
      `pay()` against a real backend + facilitator on testnet.
- [ ] If the release touches **x402**: at least one real x402 payment (agent
      or passkey signer) has settled against a real facilitator on testnet.
- [ ] If it touches **policies** or **agents**: at least one real policy
      attach/deploy or agent key mint/revoke has run against a real backend.
- [ ] No new consumer-facing error has been reported that isn't already a
      known, intentional change noted in `CHANGELOG.md`.
- [ ] `CHANGELOG.md` has an entry for this version, written as if it were
      going to `latest` — the canary and the eventual promotion are the same
      artifact and the same entry, not two.
- [ ] The canary has been live on `next` for a deliberate minimum window (days,
      not minutes), so early adopters have had a real chance to pick it up.
      Promoting immediately defeats the point of the stage.

## Promoting

1. Decide what `latest` should carry:
   - **Promote the canary version as-is** — fastest; `latest` carries a
     `-canary.N` version string.
   - **Re-tag as a plain release** (cut `v0.7.0` from the same commit) —
     cleaner version history, costs one more publish run of an
     already-validated artifact. Most releases should use this.
2. Run the promote workflow:
   ```sh
   gh workflow run promote-canary.yml -f version=0.7.0-canary.0
   ```
3. Verify: `npm view vellar-sdk dist-tags` shows `latest` on the promoted
   version.

## Testing the flow end to end

`canary-dist-tag-rollout.test.ts` exercises the whole loop as an automated
test — publish a canary, assert `latest` did not move, reject a mistyped
promotion, promote, assert `latest` moved and nothing new was published, then
a plain release. That pins the behaviour without touching the real registry.

Before relying on it for a real release, a maintainer should also run it once
against npm for real:

1. Cut a real canary and confirm via `npm view vellar-sdk dist-tags` that it
   landed on `next`, not `latest`.
2. Confirm `npm install vellar-sdk` in a scratch project still resolves to the
   previous `latest` — i.e. publishing a canary provably did not move it.
3. Run the promote workflow and confirm `latest` now points at it.
4. Confirm `npm install vellar-sdk` in a fresh scratch project resolves to the
   promoted version.

Record the outcome (date, versions, who ran it) on the release PR or tracking
issue, so there's a paper trail that the flow was actually run rather than
only reasoned about.
