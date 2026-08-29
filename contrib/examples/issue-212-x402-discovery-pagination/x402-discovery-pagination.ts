/**
 * Cursor-based pagination for x402 resource discovery.
 *
 * Contributed for issue #212: resource discovery calls have no pagination, so
 * the response grows without bound as the facilitator's catalog grows. This
 * adds an opaque-cursor paginator over a discovery source, with the same
 * page-size limit convention the balances batch reader uses
 * (`MAX_BATCH_BALANCE_SIZE` / `BatchBalanceSizeError` in src/balances.ts):
 * a named max constant plus a typed error rather than a silent clamp.
 *
 * Run with: npx vitest run contrib/examples/issue-212-x402-discovery-pagination
 */

import type { PaymentRequirements } from "../../../src/x402-types";

/** One discoverable resource advertised by a facilitator's catalog. */
export interface DiscoveredResource {
  /** Resource URL. Unique within a catalog — this is the cursor anchor. */
  resource: string;
  description?: string;
  mimeType?: string;
  /** Payment options the resource server accepts. */
  accepts: PaymentRequirements[];
  /** Last time the catalog saw a settlement for this resource (ISO 8601). */
  lastUpdated?: string;
}

/**
 * Default page size when the caller does not ask for one. Chosen to match the
 * batch balance default scale — small enough that a first page is fast on a
 * cold catalog, large enough that a typical browse is one round trip.
 */
export const DEFAULT_DISCOVERY_PAGE_SIZE = 20;

/**
 * Hard ceiling on a single discovery page. Mirrors `MAX_BATCH_BALANCE_SIZE`:
 * an over-large request is REJECTED, not silently clamped, so a caller never
 * believes it received more than it did.
 */
export const MAX_DISCOVERY_PAGE_SIZE = 100;

export class DiscoveryPageSizeError extends Error {
  constructor(
    readonly maxSize: number,
    readonly requested: number,
  ) {
    super(`discovery page size exceeds max of ${maxSize}, got ${requested}`);
    this.name = "DiscoveryPageSizeError";
  }
}

export class InvalidCursorError extends Error {
  constructor(readonly cursor: string) {
    super(`invalid discovery cursor: ${cursor}`);
    this.name = "InvalidCursorError";
  }
}

export interface DiscoveryQuery {
  /** Opaque cursor from a previous page's `next_cursor`. Omit for the first page. */
  cursor?: string;
  /** Items per page. Defaults to DEFAULT_DISCOVERY_PAGE_SIZE, capped at MAX_DISCOVERY_PAGE_SIZE. */
  limit?: number;
  /** Only return resources payable in one of these asset contract ids. */
  assets?: string[];
  /** Only return resources on this CAIP-2 network, e.g. "stellar:testnet". */
  network?: string;
}

export interface DiscoveryPage {
  resources: DiscoveredResource[];
  /**
   * Cursor for the next page, or `null` on the last page. Snake_case because
   * it crosses the wire to the facilitator's HTTP API, matching the
   * `PAYMENT-REQUIRED` / `x402Version` payload style already on the wire.
   */
  next_cursor: string | null;
  /** True when `next_cursor` is non-null. Convenience for `while` loops. */
  has_more: boolean;
}

/** The unpaginated source a paginator reads from (a fetch, a cache, a fixture). */
export interface DiscoverySource {
  listResources(): Promise<DiscoveredResource[]>;
}

export interface X402DiscoveryClient {
  /** One page of discoverable resources. */
  discover(query?: DiscoveryQuery): Promise<DiscoveryPage>;
  /** Every page, transparently followed. Use for small catalogs or CLI tools. */
  discoverAll(query?: Omit<DiscoveryQuery, "cursor">): Promise<DiscoveredResource[]>;
}

/**
 * Cursors are opaque to callers but deterministic: base64url of the last
 * resource id on the page. Anchoring to an id rather than an offset means a
 * concurrent insert earlier in the catalog cannot cause the next page to skip
 * or repeat an entry, which an offset cursor would.
 */
export function encodeCursor(resourceId: string): string {
  // Hand-rolled base64url: the SDK targets browsers/bundlers and compiles with
  // no Node types, so `Buffer` is unavailable here by design (see tsconfig).
  const bytes = new TextEncoder().encode(resourceId);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(cursor: string): string {
  if (cursor === "") throw new InvalidCursorError(cursor);
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    if (decoded === "") throw new InvalidCursorError(cursor);
    return decoded;
  } catch {
    throw new InvalidCursorError(cursor);
  }
}

/** Validates a requested page size against the limits. Throws, never clamps. */
export function resolvePageSize(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_DISCOVERY_PAGE_SIZE;
  if (!Number.isInteger(limit)) {
    throw new RangeError(`discovery page size must be an integer, got ${limit}`);
  }
  if (limit < 1) {
    throw new RangeError(`discovery page size must be at least 1, got ${limit}`);
  }
  if (limit > MAX_DISCOVERY_PAGE_SIZE) {
    throw new DiscoveryPageSizeError(MAX_DISCOVERY_PAGE_SIZE, limit);
  }
  return limit;
}

function matchesFilters(resource: DiscoveredResource, query: DiscoveryQuery): boolean {
  if (query.network && !resource.accepts.some((a) => a.network === query.network)) return false;
  if (query.assets && !resource.accepts.some((a) => query.assets!.includes(a.asset))) return false;
  return true;
}

/**
 * Pages an in-memory resource list. Exported so a caller with its own transport
 * can reuse the exact cursor semantics the client uses.
 *
 * Ordering is by `resource` id so a cursor stays meaningful across calls; a
 * source that returns entries in a different order every call cannot be paged
 * safely, and sorting here makes that guarantee independent of the source.
 */
export function paginateResources(
  all: DiscoveredResource[],
  query: DiscoveryQuery = {},
): DiscoveryPage {
  const limit = resolvePageSize(query.limit);
  const filtered = all
    .filter((r) => matchesFilters(r, query))
    .slice()
    .sort((a, b) => (a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0));

  let start = 0;
  if (query.cursor !== undefined) {
    const anchor = decodeCursor(query.cursor);
    const index = filtered.findIndex((r) => r.resource === anchor);
    // A cursor pointing at an entry that has since been removed (or is filtered
    // out by a changed filter) is not an error: resume at the next id in order
    // rather than restarting from the top and re-serving the whole catalog.
    start = index === -1 ? filtered.findIndex((r) => r.resource > anchor) : index + 1;
    if (start === -1) start = filtered.length;
  }

  const resources = filtered.slice(start, start + limit);
  const last = resources[resources.length - 1];
  const hasMore = start + resources.length < filtered.length;

  return {
    resources,
    next_cursor: hasMore && last ? encodeCursor(last.resource) : null,
    has_more: hasMore,
  };
}

export function createX402DiscoveryClient(source: DiscoverySource): X402DiscoveryClient {
  return {
    async discover(query = {}) {
      // Validate before touching the source: an over-large request must fail
      // fast rather than after a full catalog read.
      resolvePageSize(query.limit);
      return paginateResources(await source.listResources(), query);
    },

    async discoverAll(query = {}) {
      const all = await source.listResources();
      const out: DiscoveredResource[] = [];
      let cursor: string | undefined;
      // Bounded by the catalog size: each page consumes at least one entry, so
      // this terminates even if a source misbehaves.
      for (;;) {
        const page = paginateResources(all, { ...query, cursor });
        out.push(...page.resources);
        if (!page.next_cursor || page.resources.length === 0) break;
        cursor = page.next_cursor;
      }
      return out;
    },
  };
}

/**
 * Discovery source backed by a facilitator's HTTP catalog endpoint.
 *
 * The endpoint itself is unpaginated today — this fetches once and pages
 * client-side, which is the point of the issue: a caller gets bounded pages
 * now, and when the facilitator grows a real cursor API only this adapter
 * changes, not the client or the page shape.
 */
export function createHttpDiscoverySource(
  catalogUrl: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): DiscoverySource {
  return {
    async listResources() {
      const res = await fetchImpl(catalogUrl);
      if (!res.ok) {
        throw new Error(`discovery catalog request failed (HTTP ${res.status})`);
      }
      const body: unknown = await res.json();
      const items = Array.isArray(body)
        ? body
        : ((body as { resources?: unknown }).resources ?? []);
      return (Array.isArray(items) ? items : []).filter(isDiscoveredResource);
    },
  };
}

/** Catalog entries are untrusted input — anything malformed is dropped, not thrown on. */
export function isDiscoveredResource(value: unknown): value is DiscoveredResource {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.resource === "string" && v.resource.length > 0 && Array.isArray(v.accepts);
}
