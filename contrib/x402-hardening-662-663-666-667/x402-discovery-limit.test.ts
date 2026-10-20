// Issue #662 — an oversized discovery response fails fast with a named error.

import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../src/x402-client.js";
import {
  DISCOVERY_MAX_RESPONSE_BYTES,
  DiscoveryResponseTooLargeError,
  fetchDiscoveryCatalog,
} from "./x402-discovery-limit.js";

const json = (body: string, headers: Record<string, string> = {}) =>
  (async () => new Response(body, { status: 200, headers })) as FetchLike;

describe("fetchDiscoveryCatalog — response size limit", () => {
  it("parses a normal catalog", async () => {
    const out = await fetchDiscoveryCatalog<{ resources: unknown[] }>(
      "https://f.example/discovery/search",
      json(JSON.stringify({ resources: [{ resource: "https://s.example" }] })),
    );
    expect(out.resources).toHaveLength(1);
  });

  it("fails fast on a declared Content-Length over the limit, without reading the body", async () => {
    const res = new Response("{}", {
      status: 200,
      headers: { "content-length": String(DISCOVERY_MAX_RESPONSE_BYTES + 1) },
    });
    const text = vi.spyOn(res, "text");
    await expect(fetchDiscoveryCatalog("https://f.example", async () => res)).rejects.toBeInstanceOf(
      DiscoveryResponseTooLargeError,
    );
    expect(text).not.toHaveBeenCalled();
  });

  it("enforces the cap on an oversized body with no Content-Length", async () => {
    const big = JSON.stringify({ resources: [], pad: "x".repeat(2048) });
    const err = await fetchDiscoveryCatalog("https://f.example", json(big), 1024).catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryResponseTooLargeError);
    expect(err.name).toBe("DiscoveryResponseTooLargeError");
    expect(err.limitBytes).toBe(1024);
  });

  it("does not attempt JSON.parse on an oversized, invalid body", async () => {
    // If it parsed first this would be a SyntaxError, not the named error.
    await expect(
      fetchDiscoveryCatalog("https://f.example", json("{".repeat(4096)), 1024),
    ).rejects.toBeInstanceOf(DiscoveryResponseTooLargeError);
  });

  it("accepts a body exactly at the limit", async () => {
    const body = JSON.stringify({ a: "x".repeat(100) });
    await expect(
      fetchDiscoveryCatalog("https://f.example", json(body), new TextEncoder().encode(body).length),
    ).resolves.toBeDefined();
  });

  it("surfaces a non-2xx as a plain error, not a size error", async () => {
    const f: FetchLike = async () => new Response("no", { status: 503, statusText: "Unavailable" });
    await expect(fetchDiscoveryCatalog("https://f.example", f)).rejects.toThrow(/503/);
  });
});
