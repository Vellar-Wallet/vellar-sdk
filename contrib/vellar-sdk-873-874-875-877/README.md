# Catalog trust and x402 shape tooling (#873, #874, #875, #877)

Reference implementations for the four assigned `vellar-sdk` issues. Everything
is kept under `contrib/` because external contributor PRs may only change that
directory (see `CONTRIBUTING.md` rule 3 and the `close-prs-outside-contrib`
workflow).

## Issues

| Issue | Subfolder | What it adds |
| --- | --- | --- |
| #873 | [873-durability-probe/](873-durability-probe/README.md) | Client-side catalog durability probe returning durable or inconclusive |
| #874 | [874-discovery-non-assumption/](874-discovery-non-assumption/README.md) | Restart-aware discovery wrapper and test that a vanished resource is treated as gone |
| #875 | [875-seller-buyer-example/](875-seller-buyer-example/README.md) | Minimal x402 seller example paired with the SDK buyer flow against a local facilitator |
| #877 | [877-preflight-x402-shape/](877-preflight-x402-shape/README.md) | Optional pre-submission x402 shape self-check using the four explorer conditions |

## Verification

From the repo root:

```sh
npx vitest run contrib/vellar-sdk-873-874-875-877
```

The seller and buyer integration test is named `*.integration.test.ts` and is
excluded from the default suite by `vitest.config.ts`. Its environment parsing
and seller behavior are covered by hermetic unit tests.

## Baseline disclosure

The `dev` branch is broken before these changes: `npm run typecheck` fails with
syntax errors in `src/x402-signer.ts`, and the full `npm test` suite reports
failing test files. Several helpers referenced by these issues as already added
earlier in the batch do not exist on any branch (`statsSource` code type,
recatalog-on-payment recovery helper, structural-conditions classifier). Each
subfolder therefore provides a self-contained contrib reference implementation
and documents what a maintainer needs to promote.

## Maintainer follow-up required

- Move the durability probe and structural classifier into `src/` and export
  them if the issues are to become published SDK API.
- Add the discovery non-assumption note to the `x402-client.ts` discovery
  function comment.
- Add the paired seller and buyer example to `CONTRIBUTING.md`.
- Document the durability inference limitation in
  `website/content/docs/concepts/bazaar-and-discovery.md`.
