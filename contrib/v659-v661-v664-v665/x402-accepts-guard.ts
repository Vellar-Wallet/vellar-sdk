// Issue #661 — a 402 challenge that offers no payment scheme at all.
//
// WHAT SRC DOES TODAY. `selectRequirements` reads `decoded.accepts ?? []`, so an
// EMPTY or MISSING `accepts` already fails before any signing, with
// `NoUsablePaymentOptionError("No exact/stellar:testnet payment option offered.
// Server offered: (none)")`. That is named, but it reads as "you're on the wrong
// network" rather than "the seller is misconfigured".
//
// THE GAP. `?? []` only covers null/undefined. A misconfigured seller that sends
// `accepts` as an object (`{}`), a string, or a number makes
// `options.filter(...)` throw a raw `TypeError` from inside scheme matching —
// exactly the "confusing error deep in scheme-matching logic" the issue calls
// out.
//
// THE GUARD. Check the shape of `accepts` as soon as the 402 arrives and fail
// with a dedicated `NoPayableSchemeOfferedError` for every "nothing payable was
// offered" shape: missing, not an array, or empty. It extends
// NoUsablePaymentOptionError, so existing `catch (e instanceof
// NoUsablePaymentOptionError)` handlers keep working. Nothing is built,
// simulated or signed on this path.

import type { FetchLike } from "../../src/x402-client.js";
import { decodePaymentRequired } from "../../src/x402-guards.js";
import { NoUsablePaymentOptionError } from "../../src/x402-types.js";

/** The seller's 402 challenge offered no payment scheme the client could use. */
export class NoPayableSchemeOfferedError extends NoUsablePaymentOptionError {
  /** What `accepts` actually was: "missing", "empty", or its JSON type. */
  readonly received: string;

  constructor(received: string) {
    super(
      `x402: the seller's 402 challenge offered no payment schemes (accepts was ${received}). ` +
        "Nothing was signed; the seller's x402 configuration needs fixing.",
    );
    this.name = "NoPayableSchemeOfferedError";
    this.received = received;
  }
}

function describeAccepts(accepts: unknown): string | null {
  if (accepts === undefined || accepts === null) return "missing";
  if (!Array.isArray(accepts)) return `a ${typeof accepts}, not an array`;
  if (accepts.length === 0) return "empty";
  return null;
}

/** Throw NoPayableSchemeOfferedError unless `decoded.accepts` is a non-empty array. */
export function assertSchemesOffered(decoded: unknown): void {
  const accepts =
    typeof decoded === "object" && decoded !== null
      ? (decoded as { accepts?: unknown }).accepts
      : undefined;
  const problem = describeAccepts(accepts);
  if (problem !== null) throw new NoPayableSchemeOfferedError(problem);
}

/**
 * Wrap a fetch so a 402 challenge with no usable `accepts` fails fast with
 * NoPayableSchemeOfferedError. Pass as `fetchImpl` (or `x402.fetchImpl`).
 * Non-402 responses, and 402s without a decodable PAYMENT-REQUIRED header, are
 * passed through untouched for the client's own handling.
 */
export function createAcceptsGuardedFetch(
  baseFetch: FetchLike = (url, init) => fetch(url, init),
): FetchLike {
  return async (url, init) => {
    const res = await baseFetch(url, init);
    if (res.status !== 402) return res;

    let decoded: unknown;
    try {
      decoded = decodePaymentRequired(res);
    } catch {
      return res;
    }
    assertSchemesOffered(decoded);
    return res;
  };
}
