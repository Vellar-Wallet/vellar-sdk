import { describe, expect, it, vi } from "vitest";
import {
  createHttpDiscoverySource,
  createX402DiscoveryClient,
  DEFAULT_DISCOVERY_PAGE_SIZE,
  decodeCursor,
  DiscoveryPageSizeError,
  encodeCursor,
  InvalidCursorError,
  isDiscoveredResource,
  MAX_DISCOVERY_PAGE_SIZE,
  paginateResources,
  resolvePageSize,
  type DiscoveredResource,
} from "./x402-discovery-pagination";

function resource(id: string, overrides: Partial<DiscoveredResource> = {}): DiscoveredResource {
  return {
    resource: id,
    accepts: [
      {
        scheme: "exact",
        network: "stellar:testnet",
        asset: "CUSDC",
        amount: "1000",
        payTo: "CSELLER",
      },
    ],
    ...overrides,
  };
}

/** Zero-padded ids so lexicographic order matches numeric order. */
function catalog(size: number): DiscoveredResource[] {
  return Array.from({ length: size }, (_, i) =>
    resource(`https://api.example.com/r${String(i).padStart(3, "0")}`),
  );
}

const ids = (page: { resources: DiscoveredResource[] }) => page.resources.map((r) => r.resource);

describe("page size limits", () => {
  it("defaults to DEFAULT_DISCOVERY_PAGE_SIZE", () => {
    expect(resolvePageSize(undefined)).toBe(DEFAULT_DISCOVERY_PAGE_SIZE);
    expect(paginateResources(catalog(50)).resources).toHaveLength(DEFAULT_DISCOVERY_PAGE_SIZE);
  });

  it("honours an explicit limit", () => {
    expect(paginateResources(catalog(50), { limit: 5 }).resources).toHaveLength(5);
  });

  it("accepts exactly the max page size", () => {
    expect(resolvePageSize(MAX_DISCOVERY_PAGE_SIZE)).toBe(MAX_DISCOVERY_PAGE_SIZE);
  });

  it("rejects a limit above the max rather than clamping", () => {
    expect(() => resolvePageSize(MAX_DISCOVERY_PAGE_SIZE + 1)).toThrow(DiscoveryPageSizeError);
    try {
      resolvePageSize(500);
    } catch (err) {
      expect(err).toBeInstanceOf(DiscoveryPageSizeError);
      expect((err as DiscoveryPageSizeError).maxSize).toBe(MAX_DISCOVERY_PAGE_SIZE);
      expect((err as DiscoveryPageSizeError).requested).toBe(500);
    }
  });

  it("rejects zero, negative, and non-integer limits", () => {
    expect(() => resolvePageSize(0)).toThrow(RangeError);
    expect(() => resolvePageSize(-1)).toThrow(RangeError);
    expect(() => resolvePageSize(1.5)).toThrow(RangeError);
  });

  it("validates the limit before reading the source", async () => {
    const listResources = vi.fn().mockResolvedValue([]);
    const client = createX402DiscoveryClient({ listResources });
    await expect(client.discover({ limit: 9_999 })).rejects.toBeInstanceOf(DiscoveryPageSizeError);
    expect(listResources).not.toHaveBeenCalled();
  });
});

describe("cursor encoding", () => {
  it("round-trips a resource id", () => {
    const id = "https://api.example.com/r001?q=a&b=c";
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });

  it("produces url-safe cursors with no padding", () => {
    const cursor = encodeCursor("https://api.example.com/resource/with/path");
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it("round-trips non-ascii ids", () => {
    expect(decodeCursor(encodeCursor("https://例え.test/ресурс"))).toBe("https://例え.test/ресурс");
  });

  it("rejects an empty cursor", () => {
    expect(() => decodeCursor("")).toThrow(InvalidCursorError);
  });

  it("rejects a malformed cursor", () => {
    expect(() => decodeCursor("!!!not-base64!!!")).toThrow(InvalidCursorError);
  });
});

describe("pagination", () => {
  it("walks the full catalog with no duplicates or gaps", () => {
    const all = catalog(25);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      const page = paginateResources(all, { limit: 10, cursor });
      seen.push(...ids(page));
      cursor = page.next_cursor ?? undefined;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual(all.map((r) => r.resource));
  });

  it("returns next_cursor on a full page and null on the last", () => {
    const all = catalog(15);
    const first = paginateResources(all, { limit: 10 });
    expect(first.next_cursor).not.toBeNull();
    expect(first.has_more).toBe(true);

    const second = paginateResources(all, { limit: 10, cursor: first.next_cursor! });
    expect(second.resources).toHaveLength(5);
    expect(second.next_cursor).toBeNull();
    expect(second.has_more).toBe(false);
  });

  it("returns null next_cursor when the catalog fits in one page exactly", () => {
    const page = paginateResources(catalog(10), { limit: 10 });
    expect(page.resources).toHaveLength(10);
    expect(page.next_cursor).toBeNull();
    expect(page.has_more).toBe(false);
  });

  it("handles an empty catalog", () => {
    const page = paginateResources([], { limit: 10 });
    expect(page.resources).toEqual([]);
    expect(page.next_cursor).toBeNull();
    expect(page.has_more).toBe(false);
  });

  it("handles a single-item catalog", () => {
    const page = paginateResources(catalog(1), { limit: 10 });
    expect(page.resources).toHaveLength(1);
    expect(page.next_cursor).toBeNull();
  });

  it("returns a stable order regardless of source ordering", () => {
    const forward = catalog(12);
    const reversed = [...forward].reverse();
    expect(ids(paginateResources(forward, { limit: 5 }))).toEqual(
      ids(paginateResources(reversed, { limit: 5 })),
    );
  });

  it("does not mutate the caller's array", () => {
    const all = catalog(5).reverse();
    const snapshot = all.map((r) => r.resource);
    paginateResources(all, { limit: 2 });
    expect(all.map((r) => r.resource)).toEqual(snapshot);
  });

  it("resumes at the next id when the cursor anchor was deleted", () => {
    const all = catalog(10);
    const first = paginateResources(all, { limit: 5 });
    const anchor = decodeCursor(first.next_cursor!);

    const shrunk = all.filter((r) => r.resource !== anchor);
    const second = paginateResources(shrunk, { limit: 5, cursor: first.next_cursor! });

    expect(ids(second)).toEqual(shrunk.slice(4).map((r) => r.resource));
    expect(ids(second)).not.toContain(anchor);
  });

  it("does not skip or repeat when an earlier entry is inserted mid-walk", () => {
    const all = catalog(10);
    const first = paginateResources(all, { limit: 5 });

    // An entry sorting BEFORE the cursor appears between calls. An offset
    // cursor would shift the window and repeat an item; an id cursor does not.
    const grown = [...all, resource("https://api.example.com/r000-inserted")];
    const second = paginateResources(grown, { limit: 5, cursor: first.next_cursor! });

    expect(second.resources.map((r) => r.resource)).toEqual(
      all.slice(5).map((r) => r.resource),
    );
    expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
  });

  it("returns an empty last page when the cursor points past the end", () => {
    const all = catalog(5);
    const page = paginateResources(all, {
      limit: 5,
      cursor: encodeCursor("https://api.example.com/zzz-beyond-end"),
    });
    expect(page.resources).toEqual([]);
    expect(page.next_cursor).toBeNull();
  });

  it("propagates an invalid cursor as InvalidCursorError", () => {
    expect(() => paginateResources(catalog(3), { cursor: "!!!" })).toThrow(InvalidCursorError);
  });
});

describe("filters", () => {
  const mixed = [
    resource("https://a.test/1"),
    resource("https://b.test/2", {
      accepts: [
        {
          scheme: "exact",
          network: "stellar:pubnet",
          asset: "CXLM",
          amount: "5",
          payTo: "CSELLER",
        },
      ],
    }),
    resource("https://c.test/3", {
      accepts: [
        {
          scheme: "exact",
          network: "stellar:testnet",
          asset: "CXLM",
          amount: "5",
          payTo: "CSELLER",
        },
      ],
    }),
  ];

  it("filters by network", () => {
    expect(ids(paginateResources(mixed, { network: "stellar:pubnet" }))).toEqual([
      "https://b.test/2",
    ]);
  });

  it("filters by asset", () => {
    expect(ids(paginateResources(mixed, { assets: ["CUSDC"] }))).toEqual(["https://a.test/1"]);
  });

  it("paginates within a filtered set", () => {
    const page = paginateResources(mixed, { assets: ["CXLM"], limit: 1 });
    expect(page.resources).toHaveLength(1);
    expect(page.has_more).toBe(true);

    const next = paginateResources(mixed, {
      assets: ["CXLM"],
      limit: 1,
      cursor: page.next_cursor!,
    });
    expect(next.resources).toHaveLength(1);
    expect(next.next_cursor).toBeNull();
    expect(ids(next)).not.toEqual(ids(page));
  });

  it("returns an empty page when nothing matches", () => {
    const page = paginateResources(mixed, { network: "stellar:nope" });
    expect(page.resources).toEqual([]);
    expect(page.next_cursor).toBeNull();
  });
});

describe("createX402DiscoveryClient", () => {
  it("returns one bounded page from the source", async () => {
    const client = createX402DiscoveryClient({
      listResources: async () => catalog(100),
    });
    const page = await client.discover({ limit: 10 });
    expect(page.resources).toHaveLength(10);
    expect(page.next_cursor).not.toBeNull();
  });

  it("discoverAll follows every page", async () => {
    const client = createX402DiscoveryClient({ listResources: async () => catalog(45) });
    const all = await client.discoverAll({ limit: 10 });
    expect(all).toHaveLength(45);
    expect(new Set(all.map((r) => r.resource)).size).toBe(45);
  });

  it("discoverAll terminates on an empty catalog", async () => {
    const client = createX402DiscoveryClient({ listResources: async () => [] });
    await expect(client.discoverAll()).resolves.toEqual([]);
  });

  it("discoverAll respects filters", async () => {
    const client = createX402DiscoveryClient({ listResources: async () => catalog(30) });
    await expect(client.discoverAll({ network: "stellar:nope" })).resolves.toEqual([]);
  });
});

describe("createHttpDiscoverySource", () => {
  it("reads a bare array body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => catalog(3),
    });
    const source = createHttpDiscoverySource("https://facilitator.test/catalog", fetchImpl);
    await expect(source.listResources()).resolves.toHaveLength(3);
  });

  it("reads a { resources: [...] } body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ resources: catalog(2) }),
    });
    const source = createHttpDiscoverySource("https://facilitator.test/catalog", fetchImpl);
    await expect(source.listResources()).resolves.toHaveLength(2);
  });

  it("drops malformed catalog entries instead of throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [resource("https://ok.test/1"), { resource: "" }, null, { accepts: [] }],
    });
    const source = createHttpDiscoverySource("https://facilitator.test/catalog", fetchImpl);
    await expect(source.listResources()).resolves.toEqual([resource("https://ok.test/1")]);
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const source = createHttpDiscoverySource("https://facilitator.test/catalog", fetchImpl);
    await expect(source.listResources()).rejects.toThrow("HTTP 503");
  });
});

describe("isDiscoveredResource", () => {
  it.each([null, undefined, 1, "s", {}, { resource: "" }, { resource: "x" }])(
    "rejects %o",
    (value) => {
      expect(isDiscoveredResource(value)).toBe(false);
    },
  );

  it("accepts a well-formed entry", () => {
    expect(isDiscoveredResource(resource("https://a.test/1"))).toBe(true);
  });
});
