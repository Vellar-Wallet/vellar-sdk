# Canary npm dist-tag rollout

Self-contained reference for issue [#283](https://github.com/Vellar-Wallet/vellar-sdk/issues/283): a canary dist-tag stage for pre-1.0 releases, so an early-adopter consumer can validate a release before it becomes the default install for everyone.

**The full process is in [ROLLOUT.md](ROLLOUT.md)** — workflow wiring, the promotion steps, and the consumer-validation checklist.

## The problem

`.github/workflows/publish.yml` runs `npm publish --provenance --access public`
with no `--tag`, so every tag pushed publishes straight to `latest` — the
dist-tag every plain `npm install vellar-sdk` resolves to. There is no canary
stage in between.

## The rule

A semver **prerelease** tag (`v0.7.0-canary.0`, `v1.0.0-rc.0`) publishes to
`next`. A plain release tag (`v0.7.0`) publishes to `latest`.

| dist-tag | Who gets it |
| -------- | ----------- |
| `next` | Nobody by default — only `npm install vellar-sdk@next` |
| `latest` | Everyone running plain `npm install vellar-sdk` |

Promotion moves `latest` onto an already-published version via
`npm dist-tag add` — it does not rebuild or republish, so what lands on
`latest` is byte-for-byte the artifact that was validated.

## What's here

| File | What it is |
| ---- | ---------- |
| [`ROLLOUT.md`](ROLLOUT.md) | The process: workflow changes, cutting a canary, the consumer-validation checklist, promoting, and end-to-end verification. |
| `canary-dist-tag-rollout.ts` | The pure decision logic (`distTagFor`) plus a registry model (`publish`, `promoteToLatest`) that makes the flow testable. |
| `canary-dist-tag-rollout.test.ts` | 15 tests, including one exercising the full publish → validate → promote loop end to end. |

Keeping `distTagFor` in its own module rather than inline in a YAML `run:`
block is deliberate — it's exactly the kind of one-line regex that's easy to
get subtly wrong with shell quoting and impossible to unit-test in place. The
repo already does this for release-affecting logic in `scripts/verify-merged.mjs`.

## The key property

Publishing a canary must **not** move `latest`. That's what the whole stage
exists to guarantee, and it's pinned by the end-to-end test.

## Run it

```sh
npx tsx canary-dist-tag-rollout.ts
```

## Tests

```sh
npx vitest run contrib/examples/issue-283-canary-dist-tag-rollout
```
