# Chaos test for tx-rpc polling under simulated network drops (#268)

Reference implementation for [issue #268](https://github.com/Vellar-Wallet/vellar-sdk/issues/268):
Add a chaos test that simulates network failure during polling.

## What's here

- `chaos.test.ts` — chaos test simulating network drops during `waitForTransaction` polling
- `README.md` — this file

## How it works

The test provides a `droppingReader` function that returns a `TxStatusReader`
which:

1. Simulates `dropCount` network failures, each throwing `"boom: network dropped while polling"`
2. After the configured drops, serves the next status from the provided `statuses` array
3. The `waitForTransaction` function (from `src/tx-rpc.ts`) is called with this reader
4. The test asserts that polling resumes after each drop and eventually resolves
   with the correct final status

## Running the test locally

```sh
# Run just the chaos test (hermetic, no network)
npx vitest run contrib/chaos-test
```

## Contributor notes

- This module only imports from `src/` types (erased at compile time), so it
  lives entirely inside `contrib/` per the contribution rules.
- To add more drop scenarios, extend the test cases in `chaos.test.ts` or
  modify the `droppingReader` helper.
- The existing `src/tx-rpc.chaos.test.ts` in the source tree exercises the same
  pattern — this contrib version is a standalone reference for contributors.