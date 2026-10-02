// Reference implementation for issue #222: runtime assertions for the core
// x402 payload types (`PaymentRequirements`, `PaymentRequired`).
//
// x402-types.ts (src/) declares TypeScript types for these payloads but
// performs no runtime check — types are erased at build time, so a malformed
// 402 challenge from a resource server can pass straight through and fail
// later, far from the actual bad input.
//
// This module is intentionally self-contained (only type-only imports from
// ../../src/x402-types, no runtime dependency on SDK internals) so it can be
// dropped in front of `decodePaymentRequired` / `selectRequirements` by
// wrapping them, without editing any file outside contrib/. See README.md
// for the one-line wiring a maintainer would apply inside src/x402-guards.ts
// to make this the SDK's own behavior rather than an opt-in wrapper.

import type { PaymentRequired, PaymentRequirements } from "../../src/x402-types";

/**
 * A payload arriving at the x402 network boundary (a decoded `PAYMENT-REQUIRED`
 * header, typically) failed runtime validation. Carries every missing or
 * malformed field so a caller doesn't have to bisect a raw JSON blob to find
 * out what the server actually sent.
 */
export class InvalidX402PayloadError extends Error {
  constructor(
    kind: string,
    readonly problems: string[],
  ) {
    super(`Invalid ${kind} payload: ${problems.join("; ")}`);
    this.name = "InvalidX402PayloadError";
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Validate the shape of one `PaymentRequirements` entry (one accepted option
 * from a 402's `accepts` array). Returns the list of problems found — empty
 * when valid — so callers validating an array can aggregate across entries
 * with useful indices.
 */
function paymentRequirementsProblems(value: unknown, path: string): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) {
    return [`${path} must be an object`];
  }
  const v = value as Record<string, unknown>;
  if (!isNonEmptyString(v.scheme)) problems.push(`${path}.scheme must be a non-empty string`);
  if (!isNonEmptyString(v.network)) problems.push(`${path}.network must be a non-empty string`);
  if (!isNonEmptyString(v.asset)) problems.push(`${path}.asset must be a non-empty string`);
  if (typeof v.amount !== "string") problems.push(`${path}.amount must be a string`);
  if (!isNonEmptyString(v.payTo)) problems.push(`${path}.payTo must be a non-empty string`);
  if (v.maxTimeoutSeconds !== undefined && typeof v.maxTimeoutSeconds !== "number") {
    problems.push(`${path}.maxTimeoutSeconds must be a number`);
  }
  if (v.extra !== undefined && (typeof v.extra !== "object" || v.extra === null)) {
    problems.push(`${path}.extra must be an object`);
  }
  return problems;
}

/**
 * Runtime assertion for `PaymentRequirements`. Throws `InvalidX402PayloadError`
 * listing every missing/malformed field rather than letting a malformed
 * payload silently pass the type system (types are erased at runtime) and
 * fail later, further from the misconfiguration that caused it.
 */
export function assertPaymentRequirements(value: unknown): asserts value is PaymentRequirements {
  const problems = paymentRequirementsProblems(value, "requirements");
  if (problems.length > 0) {
    throw new InvalidX402PayloadError("PaymentRequirements", problems);
  }
}

/**
 * Runtime assertion for a decoded `PaymentRequired` challenge (the 402 body /
 * `PAYMENT-REQUIRED` header).
 *
 * Deliberately loose on `accepts` entries: it only checks each is an object,
 * NOT that it satisfies the full `PaymentRequirements` shape. x402 v1 servers
 * (a different wire format, e.g. `maxAmountRequired` instead of `amount`)
 * decode to this same envelope, and version negotiation needs to read
 * `x402Version` and reject those with a clear "unsupported version" message
 * before any v2-shaped field validation runs. Callers that go on to actually
 * use an accepted option as a `PaymentRequirements` (e.g. a `selectRequirements`
 * equivalent) should call {@link assertPaymentRequirements} on it once the
 * version is confirmed.
 */
export function assertPaymentRequired(value: unknown): asserts value is PaymentRequired {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) {
    throw new InvalidX402PayloadError("PaymentRequired", ["payload must be an object"]);
  }
  const v = value as Record<string, unknown>;
  if (typeof v.x402Version !== "number") {
    problems.push("x402Version must be a number");
  }
  if (!Array.isArray(v.accepts)) {
    problems.push("accepts must be an array");
  } else {
    v.accepts.forEach((entry, i) => {
      if (typeof entry !== "object" || entry === null) {
        problems.push(`accepts[${i}] must be an object`);
      }
    });
  }
  if (v.error !== undefined && typeof v.error !== "string") {
    problems.push("error must be a string");
  }
  if (problems.length > 0) {
    throw new InvalidX402PayloadError("PaymentRequired", problems);
  }
}

/**
 * Convenience wrapper: decode + assert in one call, for a caller that wants
 * to validate every offered option up front rather than only the one
 * eventually selected.
 */
export function assertAllOffered(decodedChallenge: PaymentRequired): void {
  assertPaymentRequired(decodedChallenge);
  (decodedChallenge.accepts ?? []).forEach((entry) => assertPaymentRequirements(entry));
}
