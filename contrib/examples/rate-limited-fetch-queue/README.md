# rate-limited-fetch-queue

A small, self contained queue that runs `fetch` calls with a maximum number
in flight at once, queuing the rest and starting them in FIFO order as
slots free up.

## Usage

```ts
import { RateLimitedFetchQueue } from "./rate-limited-fetch-queue";

const queue = new RateLimitedFetchQueue({ maxConcurrent: 3 });

const results = await Promise.all(
  urls.map((url) => queue.enqueue(url).then((res) => res.json())),
);
```

## API

```ts
new RateLimitedFetchQueue(options: RateLimitedFetchQueueOptions)
```

- `options.maxConcurrent` — maximum number of `fetch` calls in flight at
  once.
- `options.fetchFn` — optional `fetch` implementation override, useful for
  tests.

Methods:

- `queue.enqueue(input, init?)` — returns a `Promise<Response>` that
  resolves/rejects the same way `fetch(input, init)` would.
- `queue.pending` — number of calls still waiting for a slot.
- `queue.inFlight` — number of calls currently running.

Each call to `enqueue` returns its own promise, so results line up with the
order calls were enqueued (e.g. via `Promise.all`) even though the
underlying requests may finish in a different order.

## Demo

`demo.ts` enqueues 5 fake requests with `maxConcurrent: 2` and logs when
each one starts/finishes, showing only 2 running at a time and the final
results array preserving enqueue order:

```sh
npx tsx demo.ts
# [0ms] start  /a
# [0ms] start  /b
# [300ms] finish /a
# [300ms] start  /c
# [300ms] finish /b
# [300ms] start  /d
# [600ms] finish /c
# [600ms] start  /e
# [600ms] finish /d
# [900ms] finish /e
# results (in enqueue order): [ '/a', '/b', '/c', '/d', '/e' ]
```
