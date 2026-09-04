# Load test for concurrent payments.ts submissions (#267)

Reference implementation for [issue #267](https://github.com/Vellar-Wallet/vellar-sdk/issues/267):
Add a load test script simulating concurrent payment submissions.

## What's here

- `load.test.ts` — load test measuring latency and error rate at increasing concurrency
- `README.md` — this file

## How it works

The test simulates `PER_LEVEL` (150) payment submissions at each concurrency level
`[1, 5, 10, 25, 50, 100]`, with a configurable backend latency (default 5ms) and
deterministic failure every Nth attempt (`failEveryN`).

For each concurrency level:
- `total` submissions are attempted
- `errors` count submissions that threw errors (should be 0 when `failEveryN` is 0)
- `errPct` is the error percentage
- `p50`/`p95` are latency percentiles
- `thru` is throughput in submissions/sec

## Running the test locally

```sh
# Run just the load test (optional, not part of npm test)
npm run test:load -- --config vitest.load.config.ts
```

Or run vitest directly:

```sh
npx vitest run contrib/load-test
```

## Contributor notes

- This module only imports from `src/` types (erased at compile time), so it
  lives entirely inside `contrib/` per the contribution rules.
- To adjust concurrency levels, modify `CONCURRENCY_LEVELS` in `load.test.ts`.
- The existing `src/payments.load.test.ts` in the source tree exercises the same
  pattern — this contrib version is a standalone reference for contributors.
- This test is optional and does not gate normal PRs; it can be triggered via
  `npm run test:load` or as an optional CI job.