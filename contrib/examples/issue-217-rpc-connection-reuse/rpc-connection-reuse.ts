/**
 * Connection reuse tuning for the Soroban RPC client.
 *
 * Contributed for issue #217: the RPC client is constructed with default
 * connection settings, which suit neither Node nor browser consumers. Every
 * balance read, simulation and submit is a separate POST to the same origin, so
 * without connection reuse each one pays a fresh TCP + TLS handshake — the
 * dominant cost on a wallet screen that reads several tokens in a row.
 *
 * `rpc.Server`'s own options expose only `allowHttp` and `headers`; there is no
 * agent or pool hook on it. Tuning therefore has to happen one layer down, at
 * the HTTP client the environment gives us:
 *
 * - **Node** — reuse is opt-in. Supply a dispatcher/agent with keep-alive
 *   enabled and a connection cap, and pass a fetch bound to it.
 * - **Browser** — the user agent owns the connection pool and neither exposes
 *   nor accepts an agent. `Connection` is a forbidden header there, so setting
 *   it is not merely useless but rejected. Reuse is already the default for
 *   HTTP/1.1 keep-alive and HTTP/2 multiplexing; the only thing a consumer
 *   controls is not defeating it (no per-request cache-busting origin changes).
 *
 * This module produces the settings and the wrapped fetch, and leaves the
 * agent's construction to the caller so the SDK never has to import undici.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type RuntimeEnvironment = "node" | "browser";

export interface ConnectionReuseOptions {
  /**
   * Which environment the consumer runs in. Defaults to auto-detection: the
   * presence of a `window` with a `document` means browser.
   */
  environment?: RuntimeEnvironment;
  /** Enable HTTP keep-alive. Node only; ignored in the browser. */
  keepAlive?: boolean;
  /**
   * How long an idle socket is kept open, in ms. Too high and the RPC provider
   * closes it first (a request in flight on a server-closed socket surfaces as
   * a socket hang up); too low and a burst of reads re-handshakes anyway.
   */
  keepAliveMsecs?: number;
  /** Max simultaneous sockets per origin. */
  maxSockets?: number;
  /** Max idle sockets retained per origin between bursts. */
  maxFreeSockets?: number;
}

export interface ResolvedConnectionSettings {
  environment: RuntimeEnvironment;
  keepAlive: boolean;
  keepAliveMsecs: number;
  maxSockets: number;
  maxFreeSockets: number;
  /**
   * Headers to hand to `rpc.Server`. Empty in the browser, where `Connection`
   * is a forbidden header and the UA manages the pool itself.
   */
  headers: Record<string, string>;
}

/**
 * Recommended values, per environment. See README for the reasoning.
 *
 * Node: a wallet reads a handful of tokens concurrently, so 10 sockets covers
 * the burst without opening more connections than a public RPC endpoint will
 * tolerate from one client. 30s idle stays under the commonly-configured 60s
 * server-side idle timeout, so we close first rather than racing a server
 * close. 6 free sockets keeps the steady-state pool warm between polls.
 */
export const NODE_DEFAULTS = {
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 10,
  maxFreeSockets: 6,
} as const;

/**
 * Browser: the UA owns the pool. These values are recorded for reporting only
 * — nothing is applied, and no `Connection` header is emitted, because it is a
 * forbidden header name that the browser strips or rejects.
 */
export const BROWSER_DEFAULTS = {
  keepAlive: false,
  keepAliveMsecs: 0,
  maxSockets: 0,
  maxFreeSockets: 0,
} as const;

export function detectEnvironment(): RuntimeEnvironment {
  const w = (globalThis as { window?: { document?: unknown } }).window;
  return w && w.document ? "browser" : "node";
}

export function resolveConnectionSettings(
  options: ConnectionReuseOptions = {},
): ResolvedConnectionSettings {
  const environment = options.environment ?? detectEnvironment();

  if (environment === "browser") {
    return { environment, ...BROWSER_DEFAULTS, headers: {} };
  }

  const keepAlive = options.keepAlive ?? NODE_DEFAULTS.keepAlive;
  return {
    environment,
    keepAlive,
    keepAliveMsecs: options.keepAliveMsecs ?? NODE_DEFAULTS.keepAliveMsecs,
    maxSockets: options.maxSockets ?? NODE_DEFAULTS.maxSockets,
    maxFreeSockets: options.maxFreeSockets ?? NODE_DEFAULTS.maxFreeSockets,
    // Explicit on HTTP/1.1; harmless on HTTP/2, where the header is ignored.
    headers: keepAlive ? { Connection: "keep-alive" } : { Connection: "close" },
  };
}

/**
 * Anything with an undici-style `Agent`/`Dispatcher` shape. Typed structurally
 * so this module does not depend on undici or on @types/node.
 */
export interface ConnectionPool {
  readonly keepAliveTimeout?: number;
  readonly connections?: number;
}

export interface TunedRpcTransport {
  settings: ResolvedConnectionSettings;
  /** Fetch to hand to the RPC client; carries the pool and tuned headers. */
  fetch: FetchLike;
  /** Requests issued through this transport. */
  requestCount(): number;
  /** Distinct origins contacted — one warm pool is kept per origin. */
  origins(): string[];
}

export interface CreateTunedRpcTransportDeps {
  /** Underlying fetch. Defaults to the global. */
  fetchImpl?: FetchLike;
  /**
   * Node connection pool (e.g. `new undici.Agent({ keepAliveTimeout, connections })`).
   * Attached to each request as `dispatcher` so the sockets are actually reused.
   * Ignored in the browser.
   */
  pool?: ConnectionPool;
}

/**
 * Wraps a fetch so every RPC request carries the tuned keep-alive settings and
 * the shared pool, and counts requests/origins so reuse can be asserted.
 */
export function createTunedRpcTransport(
  options: ConnectionReuseOptions = {},
  deps: CreateTunedRpcTransportDeps = {},
): TunedRpcTransport {
  const settings = resolveConnectionSettings(options);
  const baseFetch: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const useNodePool = settings.environment === "node" && settings.keepAlive && deps.pool;

  let requests = 0;
  const seenOrigins = new Set<string>();

  return {
    settings,
    requestCount: () => requests,
    origins: () => [...seenOrigins],

    async fetch(url, init) {
      requests++;
      try {
        seenOrigins.add(new URL(url).origin);
      } catch {
        // A non-absolute URL has no origin to pool on; counting still works.
      }

      const merged: RequestInit & { dispatcher?: ConnectionPool } = {
        ...init,
        headers: { ...settings.headers, ...(init?.headers as Record<string, string> | undefined) },
      };
      // undici reads `dispatcher` off the init; the same object across calls is
      // what makes the socket reusable rather than per-request.
      if (useNodePool) merged.dispatcher = deps.pool;

      return baseFetch(url, merged);
    },
  };
}
