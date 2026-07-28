import { RequestDedupeCache } from "./index";

console.log("request-dedupe-cache tests:");

{
  const cache = new RequestDedupeCache<string>();
  let factoryCalls = 0;

  const factory = async (key: string): Promise<string> => {
    factoryCalls++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return `value-for-${key}`;
  };

  // Fire two concurrent calls for the same key.
  const [a, b] = await Promise.all([cache.get("key-1", factory), cache.get("key-1", factory)]);

  console.assert(a === "value-for-key-1", "expected first value");
  console.assert(b === "value-for-key-1", "expected second value");
  console.assert(factoryCalls === 1, `expected 1 factory call, got ${factoryCalls}`);
  console.log("ok: concurrent calls for same key share one factory call");
}

{
  const cache = new RequestDedupeCache<string>();
  let factoryCalls = 0;

  const factory = async (key: string): Promise<string> => {
    factoryCalls++;
    return `value-${key}-${Date.now()}`;
  };

  const first = await cache.get("key-1", factory);
  const second = await cache.get("key-1", factory);

  console.assert(first === second, "expected cached value");
  console.assert(factoryCalls === 1, `expected 1 factory call after cache hit, got ${factoryCalls}`);
  console.log("ok: second call returns cached value");
}

{
  const cache = new RequestDedupeCache<string>();
  let factoryCalls = 0;

  const factory = async (key: string): Promise<string> => {
    factoryCalls++;
    return `value-${key}`;
  };

  await cache.get("key-1", factory);
  cache.invalidate("key-1");
  await cache.get("key-1", factory);

  console.assert(factoryCalls === 2, `expected 2 factory calls after invalidation, got ${factoryCalls}`);
  console.log("ok: invalidation forces re-run");
}

console.log("request-dedupe-cache tests passed");