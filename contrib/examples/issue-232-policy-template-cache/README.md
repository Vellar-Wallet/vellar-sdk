# Policy Template Cache

Self-contained reference for issue [#232](https://github.com/Vellar-Wallet/vellar-sdk/issues/232): local caching of `listTemplates()`, invalidated on template-affecting mutations.

## Run tests

```bash
npx vitest run contrib/examples/issue-232-policy-template-cache
```

## Why

`PolicyClient.listTemplates()` in `src/policy-client.ts` has no caching — every call is a fresh network round-trip. A component that lists templates on every render (or several components each mounting their own call) all hit the network independently, and there's no cache for a mutation to invalidate in the first place.

## Usage

```ts
import { withTemplateCache } from "./policy-template-cache";

const cachedClient = withTemplateCache(policyClient, {
  onCacheInvalidated(event) {
    console.debug("templates cache invalidated:", event.reason, event.at);
  },
});

const templates = await cachedClient.listTemplates(); // network call
const again = await cachedClient.listTemplates(); // served from cache

await cachedClient.generate(definition); // invalidates the cache on success
const fresh = await cachedClient.listTemplates(); // network call again

// Or invalidate explicitly, e.g. after an out-of-band admin change:
await cachedClient.refreshTemplates();
```

## Semantics

| Call | Result |
|------|--------|
| `listTemplates()`, cache empty | Network call; result cached |
| `listTemplates()`, cache populated | Served from cache, no network call |
| `listTemplates()` called concurrently, cache empty | One shared in-flight request, not one per caller |
| `generate()` succeeds | Invalidates the cache (fires `onCacheInvalidated` if the cache was populated) |
| `generate()` fails | Cache untouched — nothing changed server-side, so nothing is stale |
| `refreshTemplates()` | Invalidates unconditionally and re-fetches immediately |

Two properties carry the guarantee, the same shape as [issue #209's idempotency wrapper](../issue-209-payment-idempotency):

1. **The in-flight promise is cached, not only the settled result** — a burst of concurrent callers share one request instead of each firing their own.
2. **Invalidation is observable via `onCacheInvalidated`**, not a hardcoded `console.debug` call, matching the SDK's existing injectable-callback conventions (`fetch`, `webAuthn`).

## Limits

This is an in-memory cache scoped to whatever object holds the wrapped client — it does not survive a page reload and does not coordinate across two separate wrapped-client instances (e.g. two tabs, or two independently-constructed policy clients in the same app). It also only tracks mutations made **through this wrapper's own `generate()`** — an out-of-band change (an admin action elsewhere, a different client instance calling the real `generate()` directly) won't be observed automatically; call `refreshTemplates()` after any change you know about but couldn't have seen.
