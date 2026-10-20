// Issue #662 — size limit on the discovery (Bazaar catalog) response.
//
// The catalog bounds seller-written fields only by promise (the CLI's search.ts
// clamps descriptions for the same reason), so the client must not be at the
// mercy of that promise. Integration: move into src/x402-client.ts and export
// DiscoveryResponseTooLargeError from src/x402-types.ts.

import type { FetchLike } from "../../src/x402-client.js";

/** Largest discovery response we will read: 1 MiB. A catalog page is a few KiB. */
export const DISCOVERY_MAX_RESPONSE_BYTES = 1024 * 1024;

/** A discovery response exceeded the size limit. It was never parsed. */
export class DiscoveryResponseTooLargeError extends Error {
  constructor(
    readonly limitBytes: number,
    readonly observedBytes?: number,
  ) {
    super(
      `x402 discovery response exceeds the ${limitBytes}-byte limit` +
        (observedBytes !== undefined ? ` (saw at least ${observedBytes} bytes)` : "") +
        "; refusing to parse it.",
    );
    this.name = "DiscoveryResponseTooLargeError";
  }
}

/**
 * Fetch a discovery URL and parse it as JSON, failing fast with
 * {@link DiscoveryResponseTooLargeError} if the body exceeds `maxBytes` — BEFORE
 * it reaches JSON.parse. Checks `Content-Length` first (no body read), then
 * counts bytes while streaming, since the header can be absent or lie.
 * Rejects rather than truncates: a truncated JSON document is not trustworthy.
 */
export async function fetchDiscoveryCatalog<T = unknown>(
  url: string,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
  maxBytes: number = DISCOVERY_MAX_RESPONSE_BYTES,
): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`x402 discovery failed: ${res.status} ${res.statusText}`);
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new DiscoveryResponseTooLargeError(maxBytes, declared);
  }
  const reader = res.body?.getReader();
  if (!reader) return JSON.parse(await res.text()) as T;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DiscoveryResponseTooLargeError(maxBytes, total);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
