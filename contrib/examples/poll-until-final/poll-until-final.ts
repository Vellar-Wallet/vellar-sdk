// Example: poll a status function for a transaction hash on an interval
// until it reports a final ("success" | "failed") status, or reject once a
// maximum number of attempts is exhausted.
//
// Run with: npx tsx poll-until-final.ts

export type TxStatus = "pending" | "success" | "failed";
export type StatusFn = (hash: string) => Promise<TxStatus>;

export class PollTimeoutError extends Error {
  constructor(hash: string, maxAttempts: number) {
    super(`Transaction ${hash} was still pending after ${maxAttempts} attempts`);
    this.name = "PollTimeoutError";
  }
}

export interface PollOptions {
  intervalMs: number;
  maxAttempts: number;
  /** Injectable sleep, so tests can run without real delays. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Calls `getStatus(hash)` up to `maxAttempts` times, waiting `intervalMs`
 * between attempts. Resolves as soon as a non-pending status is seen;
 * rejects with PollTimeoutError if every attempt returns "pending".
 */
export async function pollUntilFinal(
  getStatus: StatusFn,
  hash: string,
  options: PollOptions,
): Promise<"success" | "failed"> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const status = await getStatus(hash);
    if (status !== "pending") return status;
    if (attempt < options.maxAttempts) {
      await sleep(options.intervalMs);
    }
  }
  throw new PollTimeoutError(hash, options.maxAttempts);
}

async function main() {
  // A mock status function: pending for the first two calls, then success.
  let calls = 0;
  const mockGetStatus: StatusFn = async () => {
    calls++;
    return calls < 3 ? "pending" : "success";
  };

  const result = await pollUntilFinal(mockGetStatus, "mock-tx-hash", {
    intervalMs: 50,
    maxAttempts: 5,
  });
  console.log(`Final status after ${calls} calls: ${result}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
