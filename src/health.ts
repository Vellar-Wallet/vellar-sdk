// Lightweight RPC endpoint reachability helper (subpath export — see rpc.ts,
// alongside balances-rpc and tx-rpc: pulls in @stellar/stellar-sdk, so it stays
// out of the root bundle for consumers that never touch the network).
//
// The point is cheap, fast confidence *before* wallet operations: is this RPC
// endpoint up, and how round-trip-costly is it right now? It returns a typed,
// discriminated result — `{ reachable: true, latencyMs }` on success, or
// `{ reachable: false, error }` on any failure or timeout — never throws.
// Pinging the RPC endpoint is the canonical "is the networkable backend
// reachable" check for a Soroban RPC URL.

import { rpc } from "@stellar/stellar-sdk";

/** Time the hop takes on a healthy check (default 5000ms). */
const DEFAULT_TIMEOUT_MS = 5000;

export interface IsReachableOptions {
  /** Fail the check if no response within this many ms. Default 5000. */
  timeoutMs?: number;
  /** Injectable ping for tests; defaults to `rpc.Server.getHealth()`. */
  ping?: (rpcUrl: string) => Promise<unknown>;
  /** Injectable clock for measuring latency; defaults to `performance.now()`. */
  now?: () => number;
}

export type ReachabilityResult =
  | {
      /** The endpoint answered within the timeout. */
      reachable: true;
      /** Round-trip latency of the ping, in milliseconds. */
      latencyMs: number;
    }
  | {
      /** The endpoint failed, errored, or timed out. */
      reachable: false;
      /** A human-readable description of why it is unreachable. */
      error: string;
    };

function defaultPing(rpcUrl: string): Promise<unknown> {
  const server = new rpc.Server(rpcUrl);
  return server.getHealth();
}

function defaultNow(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
}

/**
 * Ping the configured Soroban RPC endpoint and report whether it is reachable.
 *
 * Never throws — it resolves to a typed {@link ReachabilityResult}. Use it to
 * short-circuit wallet operations behind a dead RPC, or to pick between
 * endpoints before starting a flow:
 *
 * ```ts
 * import { isReachable } from "vellar-sdk/rpc";
 *
 * const rpc = await isReachable(config.rpcUrl, { timeoutMs: 3000 });
 * if (!rpc.reachable) return showOffline(rpc.error);
 * startWallet(); // latencyMs is available if you want to surface rpc health
 * ```
 */
export async function isReachable(
  rpcUrl: string,
  options: IsReachableOptions = {},
): Promise<ReachabilityResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? defaultNow;
  const ping = options.ping ?? defaultPing;

  // raced so a hung endpoint still yields a fast, typed `unreachable` rather
  // than leaving the consumer's flow blocked on an indefinite network wait.
  const timeout = new Promise<never>((_, reject) => {
    // The timer is allowed to keep running so a slow-but-eventual response
    // cannot resurrect the promise; the check has already returned.
    setTimeout(() => reject(new Error(`RPC health check timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const started = now();
  try {
    await Promise.race([ping(rpcUrl), timeout]);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { reachable: false, error };
  }
  const latencyMs = Math.max(0, now() - started);
  return { reachable: true, latencyMs };
}
