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

/**
 * Minimum `channelPool.available` reading considered healthy. Below this the
 * facilitator is reachable but has too few submission channels free to be
 * trusted for new work (documented in operators/limits.md).
 */
const MIN_AVAILABLE_CHANNELS = 1;

/** The documented subset of the facilitator `/health` response we classify on. */
export interface FacilitatorHealth {
  /** Overall service status; anything other than "ok" is unhealthy. */
  status?: string;
  /** Submission channel pool counters. */
  channelPool?: {
    /** Channels currently free to accept submissions. */
    available?: number;
    /** Total channels in the pool. */
    total?: number;
  };
  /**
   * Entries the facilitator could not verify. Absence means zero (documented
   * behaviour); any present non-zero reading is concerning.
   */
  unverifiableEntries?: number;
  /** Commit / build identifier of the running facilitator. */
  commit?: string;
}

export interface CheckFacilitatorLivenessOptions {
  /** Fail the check if no response within this many ms. Default 5000. */
  timeoutMs?: number;
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export type FacilitatorLivenessResult =
  | {
      /** The facilitator could not be reached (network error or timeout). */
      state: "unreachable";
      /** A human-readable description of why it is unreachable. */
      error: string;
    }
  | {
      /** The facilitator answered but reported an unhealthy internal state. */
      state: "reachable-unhealthy";
      /** The parsed health body, when one was returned. */
      health?: FacilitatorHealth;
      /** Why the reachable facilitator is considered unhealthy. */
      reason: string;
    }
  | {
      /** The facilitator answered and reported a healthy internal state. */
      state: "reachable-healthy";
      /** The parsed health body. */
      health: FacilitatorHealth;
    };

function defaultFetch(): typeof fetch {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof f !== "function") {
    throw new Error("global fetch is not available in this environment");
  }
  return f;
}

function classifyHealth(health: FacilitatorHealth): string | undefined {
  if (health.status !== undefined && health.status !== "ok") {
    return `facilitator reported status "${health.status}"`;
  }
  const available = health.channelPool?.available;
  if (typeof available === "number" && available < MIN_AVAILABLE_CHANNELS) {
    return `facilitator channelPool.available is ${available} (below ${MIN_AVAILABLE_CHANNELS})`;
  }
  // Absence of unverifiableEntries means zero; only a present non-zero value
  // is concerning.
  const unverifiable = health.unverifiableEntries;
  if (typeof unverifiable === "number" && unverifiable !== 0) {
    return `facilitator reported ${unverifiable} unverifiableEntries`;
  }
  return undefined;
}

/**
 * Probe a facilitator's `/health` endpoint and classify its liveness.
 *
 * Unlike {@link isReachable}, which only answers "is it up?", this distinguishes
 * a facilitator that is *down* (`unreachable`) from one that is *up but
 * unhealthy* (`reachable-unhealthy`) — e.g. a non-`ok` `status`, an exhausted
 * `channelPool.available`, or a non-zero `unverifiableEntries`. Never throws.
 *
 * ```ts
 * import { checkFacilitatorLiveness } from "vellar-sdk/rpc";
 *
 * const live = await checkFacilitatorLiveness(config.facilitatorUrl);
 * if (live.state === "unreachable") return showOffline(live.error);
 * if (live.state === "reachable-unhealthy") return showDegraded(live.reason);
 * submitPayment(); // reachable-healthy
 * ```
 */
export async function checkFacilitatorLiveness(
  facilitatorUrl: string,
  options: CheckFacilitatorLivenessOptions = {},
): Promise<FacilitatorLivenessResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? defaultFetch();

  const controller =
    typeof AbortController === "function" ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(`facilitator health check timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const url = `${facilitatorUrl.replace(/\/+$/, "")}/health`;

  let response: Response;
  try {
    response = await Promise.race([
      fetchImpl(url, controller ? { signal: controller.signal } : {}),
      timeout,
    ]);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { state: "unreachable", error };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  let health: FacilitatorHealth | undefined;
  try {
    health = (await response.json()) as FacilitatorHealth;
  } catch {
    health = undefined;
  }

  if (!response.ok) {
    return {
      state: "reachable-unhealthy",
      health,
      reason: `facilitator health returned HTTP ${response.status}`,
    };
  }

  const reason = health ? classifyHealth(health) : undefined;
  if (reason !== undefined) {
    return { state: "reachable-unhealthy", health, reason };
  }

  return { state: "reachable-healthy", health: health ?? {} };
}
