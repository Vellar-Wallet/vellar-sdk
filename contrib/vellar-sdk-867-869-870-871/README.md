# Vellar SDK consumer tooling (#867, #869, #870, #871)

Reference implementations for the four assigned `vellar-sdk` issues. Everything
in this folder lives under `contrib/` because external contributor PRs may only
change that directory (see `CONTRIBUTING.md` rule 3 and the
`close-prs-outside-contrib` workflow).

## Issues

| Issue | Subfolder | What it adds |
| --- | --- | --- |
| #867 | [867-budget-gate/](867-budget-gate/README.md) | Pre-payment budget gate combining a quoted price with a measured fee estimate |
| #869 | [869-local-facilitator-integration/](869-local-facilitator-integration/README.md) | Opt-in quote-and-pay integration test against a locally run facilitator, with clean skip |
| #870 | [870-channel-account-fixture/](870-channel-account-fixture/README.md) | Fresh 50-key `CHANNEL_ACCOUNT_SECRET_KEYS` generator plus a validator |
| #871 | [871-sdk-consumer-setup-doc/](871-sdk-consumer-setup-doc/README.md) | SDK-consumer focused local facilitator setup page |

## Verification

From the repo root:

```sh
npx vitest run contrib/vellar-sdk-867-869-870-871
```

The four issue subfolders contain only hermetic tests. The live facilitator test
in #869 is named `*.integration.test.ts` and is excluded from the default suite
by `vitest.config.ts`; run it only with a local facilitator as described in its
README.

## Baseline disclosure

The `dev` branch is currently broken before these changes: `npm run typecheck`
fails with syntax errors in `src/x402-signer.ts`, and `npm test` reports 47
failing test files. Also, `estimateFeeBidRefusal` in `src/x402-guards.ts`
imports `MEASURED_FEE_BIDS` and `MeasuredPaymentType` from
`src/x402-budget-attributes.ts`, which actually exports
`MEASURED_MAX_TX_FEE_STROOPS` and `MeasuredFeePaymentType`. That helper cannot
be imported at runtime, so #867 uses the real constants directly and documents
the upstream fix needed. None of these baseline problems are introduced here.

## Maintainer follow-up required

These changes were kept inside `contrib/` to survive the contributor PR guard.
To fully satisfy the literal issue text, a maintainer would need to:

- Fix the broken imports in `src/x402-guards.ts` and promote the #867 gate to a
  public helper if desired.
- Add inbound links from `website/content/docs/getting-started/` and
  `website/content/docs/operators/{limits,configuration}.md` to the #871 page,
  and register it in `website/lib/docs-registry.ts` (there is no `meta.json` in
  this repo).
- Add the #869 prerequisites to `CONTRIBUTING.md` and the #870 generator as a
  setup step there.
