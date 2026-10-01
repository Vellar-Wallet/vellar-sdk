# Coverage Baseline

Measured 2026-09-29 with:

```sh
npm run --prefix contrib/coverage-runner coverage
```

Instrumentation is limited to `src/**/*.ts` and `packages/*/src/**/*.ts`.
`contrib/`, integration tests, and load tests are excluded.

| Metric | Baseline |
| --- | ---: |
| Statements | 49.97% |
| Branches | 89.73% |
| Functions | 80.78% |
| Lines | 49.97% |

Vitest emitted this report with `coverage.reportOnFailure` enabled. At
measurement time, 446 tests passed and four suites failed during transform:
`src/index.exports.test.ts`, `src/x402-signer-policies.test.ts`, and
`src/x402-signer.test.ts` are blocked by malformed syntax in
`src/x402-signer.ts`; `src/session.test.ts` ends before its test block closes.
Treat this as a qualified baseline until those suites run. No threshold is set;
discuss one only after the baseline and test health are reviewed.