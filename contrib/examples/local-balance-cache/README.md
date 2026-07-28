# local-balance-cache

Small in-memory balance cache keyed by account and token with a configurable expiry.

## Usage

```ts
import { LocalBalanceCache } from "./index";

const cache = new LocalBalanceCache({ ttlMs: 5000 });

cache.set("GACC", "USDC", 1000000n);
const balance = cache.get("GACC", "USDC");
console.log(balance); // 1000000n
```

## API

- `set(account, token, value)` — store a balance with expiry.
- `get(account, token)` — returns `bigint | undefined` (undefined when missing or expired).
- `invalidate(account, token)` — removes a cached entry immediately.
- `clear()` — removes all entries.