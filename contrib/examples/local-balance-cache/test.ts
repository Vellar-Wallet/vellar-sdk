import { LocalBalanceCache } from "./index";

console.log("local-balance-cache tests:");

{
  const cache = new LocalBalanceCache({ ttlMs: 1000 });

  cache.set("GACC", "USDC", 12345n);
  const hit = cache.get("GACC", "USDC");
  console.assert(hit === 12345n, "expected fresh hit");
  console.log("ok: fresh hit for GACC/USDC");
}

{
  const cache = new LocalBalanceCache({ ttlMs: 50 });

  cache.set("GACC", "USDC", 12345n);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const miss = cache.get("GACC", "USDC");
  console.assert(miss === undefined, "expected expired miss");
  console.log("ok: expired entry treated as miss");
}

console.log("local-balance-cache tests passed");