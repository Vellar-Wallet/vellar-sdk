// Example: add randomized jitter to the fixed-interval polling in
// waitForTransaction (src/tx-status.ts), so many consumer instances polling
// the same RPC endpoint don't all retry in lockstep.
//
// src/tx-status.ts's `waitForTransaction` sleeps for exactly `intervalMs`
// between every poll. When many independent processes start polling around
// the same time — e.g. a fleet of workers all submitting transactions on a
// deploy — their polls synchronize and hit the RPC endpoint in bursts
// ("thundering herd"), rather than being spread out. This wraps the same
// polling loop with "full jitter": each delay is a random value in
// [0, intervalMs * (1 + jitterFactor)], capped by maxDelayMs, so retries
// spread out over time instead of clustering.
//
// Run with: npx tsx tx-status-jitter.ts

import type { TxStatus, TxStatusReader } from "../../../src/tx-status";
import { TransactionTimeoutError } from "../../../src/tx-status";

export { TransactionTimeoutError };
export type { TxStatus, TxStatusReader };

export interface JitterOptions {
  timeoutMs?: number;
  /** Base polling interval before jitter is applied. */
  intervalMs?: number;
  /**
   * Fraction of `intervalMs` the delay may randomly grow by, e.g. `0.5` means
   * each delay is drawn from `[0, intervalMs * 1.5]`. Must be >= 0.
   * Default: 0.5.
   */
  jitterFactor?: number;
  /**
   * Hard upper bound on any single jittered delay, however large
   * `intervalMs * (1 + jitterFactor)` computes to. Keeps a misconfigured
   * jitterFactor from producing unbounded waits. Default: 10x `intervalMs`.
   */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Injectable source of randomness in [0, 1), for deterministic tests. Defaults to Math.random. */
  random?: () => number;
}

/**
 * Computes one jittered delay using "full jitter": a delay drawn uniformly
 * from `[0, intervalMs * (1 + jitterFactor)]`, capped at `maxDelayMs`. Full
 * jitter (rather than adding/subtracting a percentage of the base interval)
 * is what actually breaks up synchronized retries — see the AWS
 * Architecture Blog's "Exponential Backoff And Jitter" for the analysis this
 * follows; the same reasoning applies to a fixed-interval poll, not just
 * exponential backoff.
 */
export function computeJitteredDelay(
  intervalMs: number,
  {
    jitterFactor = 0.5,
    maxDelayMs = intervalMs * 10,
    random = Math.random,
  }: Pick<JitterOptions, "jitterFactor" | "maxDelayMs" | "random"> = {},
): number {
  if (intervalMs < 0) throw new RangeError("intervalMs must be >= 0");
  if (jitterFactor < 0) throw new RangeError("jitterFactor must be >= 0");
  if (maxDelayMs < 0) throw new RangeError("maxDelayMs must be >= 0");

  const upperBound = intervalMs * (1 + jitterFactor);
  const delay = random() * upperBound;
  return Math.min(delay, maxDelayMs);
}

/**
 * Same contract as `waitForTransaction` in src/tx-status.ts — polls until a
 * final ("success" | "failed") status, throwing `TransactionTimeoutError` on
 * timeout — except the delay between polls is jittered via
 * `computeJitteredDelay` instead of being a fixed `intervalMs`, and the
 * jittered delay is always kept within `maxDelayMs`.
 */
export async function waitForTransactionJittered(
  reader: TxStatusReader,
  hash: string,
  options: JitterOptions = {},
): Promise<"success" | "failed"> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const jitterFactor = options.jitterFactor ?? 0.5;
  const maxDelayMs = options.maxDelayMs ?? intervalMs * 10;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;

  const deadline = now() + timeoutMs;
  for (;;) {
    const status = await reader.getStatus(hash);
    if (status !== "pending") return status;

    const delay = computeJitteredDelay(intervalMs, { jitterFactor, maxDelayMs, random });
    if (now() + delay > deadline) throw new TransactionTimeoutError(hash, timeoutMs);
    await sleep(delay);
  }
}

async function main() {
  let calls = 0;
  const mockReader: TxStatusReader = {
    async getStatus() {
      calls++;
      return calls < 4 ? "pending" : "success";
    },
  };

  const delaysSeen: number[] = [];
  const result = await waitForTransactionJittered(mockReader, "mock-hash", {
    intervalMs: 1000,
    jitterFactor: 0.5,
    sleep: async (ms) => {
      delaysSeen.push(ms);
    },
  });

  console.log(`Result: ${result} after ${calls} calls`);
  console.log(`Delays used (ms): ${delaysSeen.map((d) => d.toFixed(1)).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
