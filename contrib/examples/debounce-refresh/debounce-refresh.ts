// Example: debounce repeated calls to a mock refreshBalance function so
// only the last call in a burst actually runs.
//
// Run with: npx tsx debounce-refresh.ts

export type DebouncedFn<Args extends unknown[]> = (...args: Args) => void;

/** Wraps `fn` so that a burst of calls within `delayMs` of each other
 * collapses into a single call — the last one, after the burst goes quiet. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): DebouncedFn<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

async function main() {
  let refreshCount = 0;
  const refreshBalance = (accountId: string) => {
    refreshCount++;
    console.log(`refreshBalance called (call #${refreshCount}) for ${accountId}`);
  };

  const debouncedRefresh = debounce(refreshBalance, 100);

  console.log("Firing 5 rapid calls in a burst...");
  for (let i = 0; i < 5; i++) {
    debouncedRefresh("CACCOUNTSAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  }

  // Wait past the debounce window to let the last (and only) call fire.
  await new Promise((resolve) => setTimeout(resolve, 200));
  console.log(`Total actual refreshes: ${refreshCount} (expected 1, despite 5 calls)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
