# exponential-backoff

Self-contained example that computes increasing delay values for retry attempts
using exponential backoff with a maximum cap.

## Usage

```ts
import { computeBackoffDelay, backoffDelays } from "./index";

const options = { baseDelay: 500, multiplier: 2, maxDelay: 5000 };

console.log(computeBackoffDelay(options, 0)); // 500
console.log(computeBackoffDelay(options, 3)); // 4000
console.log(computeBackoffDelay(options, 5)); // 5000 (capped)

for (const delay of backoffDelays(options)) {
  console.log(delay);
  if (delay === options.maxDelay) break;
}
```

## API

- `computeBackoffDelay(options, attempt)` — returns delay in ms for the given attempt.
- `backoffDelays(options)` — infinite generator yielding delays for attempts 0, 1, 2, …

## Options

- `baseDelay: number` — base delay in ms for attempt 0.
- `multiplier?: number` — multiplier applied per attempt. Default: 2.
- `maxDelay: number` — ceiling for any returned delay.