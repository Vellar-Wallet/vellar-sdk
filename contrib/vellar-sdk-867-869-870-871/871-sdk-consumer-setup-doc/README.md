# SDK consumer local facilitator setup page (#871)

`local-facilitator-for-sdk-consumers.md` is the narrow, consumer-facing page the
issue asks for. It covers only the four environment variables needed to get a
local facilitator running for SDK development, links to the exact one-command
startup from `operators/limits.md`, and points back to the full operator
reference instead of duplicating it.

`doc-page.test.ts` checks that the page contains all four variables with SDK
appropriate example values and that its cross-links and maintainer follow-up
notes are present.

## Maintainer follow-up

The issue asks for inbound links from `getting-started` and from
`operators/limits.md` and `operators/configuration.md`, plus a navigation entry.
Those files are outside `contrib/`, so this PR cannot change them. The page
ends with a section spelling out the required edits, including the fact that
navigation is driven by `website/lib/docs-registry.ts` because there is no
`meta.json` in this repository.

## Verification

```sh
npx vitest run contrib/vellar-sdk-867-869-870-871/871-sdk-consumer-setup-doc
```
