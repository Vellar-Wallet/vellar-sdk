# format-policy-summary

Formats a policy spending limit and a window (in seconds) as a human
readable sentence, such as `"100 XLM per day"`.

## Usage

```ts
import { formatPolicySummary } from "./format-policy-summary";

formatPolicySummary(100, 86400); // "100 XLM per day"
```

Or run it as a script:

```sh
npx tsx format-policy-summary.ts 100 86400
```

## API

```ts
function formatPolicySummary(
  limit: bigint | number | string,
  windowSeconds: number,
  options?: { unit?: string }, // defaults to "XLM"
): string;
```

Recognized windows (`60`, `3600`, `86400`, `604800`) get a friendly label.
Any other window length falls back to printing the raw seconds.

## Examples

| Limit | Window (s) | Output                     |
| ----- | ---------- | --------------------------- |
| `100`   | `3600`       | `100 XLM per hour`          |
| `50`    | `86400`      | `50 XLM per day`            |
| `1000`  | `604800`     | `1000 XLM per week`         |
| `25`    | `60`         | `25 XLM per minute`         |
| `10`    | `120`        | `10 XLM per 120 seconds`    |
