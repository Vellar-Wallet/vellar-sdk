// Issue #665 — a seller must not be able to retarget a signed payment with an
// HTTP redirect.
//
// THE GAP. `createX402Client` sends both the probe and the paid retry through
// `fetchImpl`, which defaults to global `fetch` with `redirect: "follow"`. The
// WHATWG fetch spec only strips `Authorization` (and cookies, by origin) on a
// cross-origin redirect — it forwards custom request headers such as
// `PAYMENT-SIGNATURE` to wherever `Location` points. So a hostile seller
// (adversary A1 in the threat model, who controls the 402 response and every
// header after it) can answer the paid retry with
// `302 Location: https://collector.attacker.example/…` and the client will
// re-send the signed payment there automatically. A redirected PROBE is worse:
// the client would decode a 402 from the attacker's host and pay its terms.
//
// THE DECISION. Validate every redirect target against the origin of the URL
// the caller asked for (the originally discovered resource), and refuse
// anything else with a named error before a single byte reaches the other
// host. Same-origin redirects (e.g. `/paid` → `/paid/v2`) are still followed,
// with a hop limit. "Origin" is scheme + host + port, so an https → http
// downgrade or a sibling subdomain is refused too.
//
// Following is done by hand (`redirect: "manual"`) because only then can the
// target be checked before the request is sent. In browsers, a manual redirect
// is an opaque response whose `Location` cannot be read; it cannot be shown to
// be same-origin, so it is refused as well.

import type { FetchLike } from "../../src/x402-client.js";

/** Thrown when a resource redirects to an origin other than the one requested. */
export class X402CrossOriginRedirectError extends Error {
  /** Origin of the originally requested resource. */
  readonly from: string;
  /** The redirect target, or null when the runtime hid it (opaque redirect). */
  readonly to: string | null;

  constructor(from: string, to: string | null) {
    super(
      to === null
        ? `x402: refused a redirect from ${from} whose target the runtime hid (opaque redirect); ` +
            "an unverifiable redirect could retarget the payment."
        : `x402: refused a cross-origin redirect from ${from} to ${to}; ` +
            "a payment is only sent to the origin it was requested from.",
    );
    this.name = "X402CrossOriginRedirectError";
    this.from = from;
    this.to = to;
  }
}

/** Thrown when same-origin redirects exceed the hop limit. */
export class X402TooManyRedirectsError extends Error {
  readonly maxRedirects: number;

  constructor(maxRedirects: number) {
    super(`x402: more than ${maxRedirects} redirects; refusing to keep following.`);
    this.name = "X402TooManyRedirectsError";
    this.maxRedirects = maxRedirects;
  }
}

export interface RedirectGuardOptions {
  /** Same-origin redirects to follow before giving up (default 3). */
  maxRedirects?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Wrap a fetch so that every request it makes — including the x402 paid retry —
 * only ever reaches the origin of the URL it was called with. Pass the result
 * as `fetchImpl` to `createX402Client` (or `x402.fetchImpl` in
 * `createVellarWallet`).
 */
export function createRedirectGuardedFetch(
  baseFetch: FetchLike = (url, init) => fetch(url, init),
  options: RedirectGuardOptions = {},
): FetchLike {
  const maxRedirects = options.maxRedirects ?? 3;

  return async (url, init) => {
    const origin = new URL(url).origin;
    let target = url;
    let requestInit: RequestInit = { ...init, redirect: "manual" };

    for (let hops = 0; ; hops++) {
      const res = await baseFetch(target, requestInit);

      if (res.type === "opaqueredirect") {
        throw new X402CrossOriginRedirectError(origin, null);
      }
      const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get("location") : null;
      if (location === null) return res;

      const next = new URL(location, target);
      if (next.origin !== origin) {
        throw new X402CrossOriginRedirectError(origin, next.href);
      }
      if (hops >= maxRedirects) {
        throw new X402TooManyRedirectsError(maxRedirects);
      }

      // Same method/body semantics as fetch's own redirect handling.
      const method = (requestInit.method ?? "GET").toUpperCase();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        requestInit = { ...requestInit, method: "GET", body: undefined };
      }
      target = next.href;
    }
  };
}
