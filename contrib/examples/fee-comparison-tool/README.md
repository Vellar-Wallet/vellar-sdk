# Transaction fee comparison tool

`recommendFeeOption(maxWaitSeconds)` compares estimated fees for a payment
across `low`, `medium`, and `high` priority levels and recommends the
**cheapest** option whose estimated confirmation time still meets a
caller-supplied maximum wait time. If no priority level confirms within the
deadline, it returns `recommended: null` with a reason rather than silently
picking an option that would miss it.

## Fee table

A hardcoded sample fee and expected confirmation time per priority level
(a real integration would read this from a fee oracle):

| Priority | Fee (stroops) | Est. confirmation |
| -------- | ------------- | ------------------ |
| low      | 100           | 300s                |
| medium   | 10,000        | 60s                 |
| high     | 1,000,000     | 5s                  |

## Usage

```ts
import { recommendFeeOption } from "./fee-comparison-tool";

const result = recommendFeeOption(120); // must confirm within 120s

result.recommended?.priority; // "medium" (low misses the 120s deadline)
result.reasoning;
// '"medium" is the cheapest of 2 option(s) confirming within 120s (10000 stroops, ~60s).'
```

## Run it

```sh
npx tsx fee-comparison-tool.ts
```

Expected output (for a sample 120s deadline):

```
Comparing fee options for a deadline of 120s:
  low          100 stroops, ~300s (misses deadline)
  medium     10000 stroops, ~60s
  high     1000000 stroops, ~5s

Recommendation: medium
Reasoning: "medium" is the cheapest of 2 option(s) confirming within 120s (10000 stroops, ~60s).
```

## Tests

```sh
npx vitest run contrib/examples/fee-comparison-tool
```
