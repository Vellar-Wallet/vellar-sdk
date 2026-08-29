# request-dedupe-cache

Deduplicates in-flight async requests by key so concurrent callers for the same key share one underlying call. Results are cached for subsequent calls.

## Usage

```ts
import { RequestDedupeCache } from "./index";

const cache = new RequestDedupeCache<string>();

const factory = async (key: string): Promise<string> => {
  const res = await fetch(`/api/${key}`);
  return res.json();
};

// These two calls run concurrently for the same key; only one network request fires.
const [a, b] = await Promise.all([
  cache.get("resource-1", factory),
  cache.get("resource-1", factory),
]);

console.log(a, b); // Both resolve to the same value
```

## API

- `cache.get(key, factory)` — returns a cached value, an in-flight promise, or starts a new request.
- `cache.invalidate(key)` — clears the cached entry so the next call re-runs the factory.
- `cache.clear()` — clears all cached and in-flight entries.

## Notes

- Keys are plain strings.
- The factory receives the key as its argument.
- A second call for a key already in flight awaits the same promise.
- After the in-flight request resolves the result is cached.