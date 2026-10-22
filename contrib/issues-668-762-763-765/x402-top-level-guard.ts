// Type-shape fence guard for x402 responses (#668).
//
// WHY THIS EXISTS:
// In x402 v2, payment requirements are decoded from the `PAYMENT-REQUIRED` header
// (or response body). While valid JSON is expected, an adversarial seller or proxy
// could return a valid JSON payload of the wrong top-level type (e.g. bare array,
// bare string, bare number, or null).
//
// Naive handling can fail in two catastrophic ways:
// 1. Property-access crashes: Attempting to read `decoded.accepts` on `null` throws
//    an unhandled TypeError ("Cannot read properties of null (reading 'accepts')").
// 2. Model-facing prompt injection leaks: If a bare string or array containing
//    hostile text bypasses structural validation, it may be forwarded into downstream
//    model-facing contexts (such as `renderUntrusted` or tool summaries) before the
//    field-level validation rejects it.
//
// Type-shape validation serves as a distinct structural fence that runs IMMEDIATELY
// after JSON parsing, BEFORE any field-level validation (e.g. checking `accepts`
// array elements, `amount`, or `network`).

import { NoUsablePaymentOptionError } from "../../src/x402-types.js";
import type { PaymentRequired } from "../../src/x402-types.js";
import { base64ToUtf8 } from "../../src/x402-guards.js";

/**
 * Named error thrown when a PAYMENT-REQUIRED payload parses as JSON but is
 * not a dictionary object.
 *
 * Inherits from `NoUsablePaymentOptionError` to preserve backward compatibility
 * with existing catch blocks that expect payment rejection errors.
 */
export class InvalidPaymentRequiredShapeError extends NoUsablePaymentOptionError {
  constructor(actualType: string) {
    super(
      `PAYMENT-REQUIRED header must decode to a JSON object (received: ${actualType}).`,
    );
    this.name = "InvalidPaymentRequiredShapeError";
  }
}

/**
 * Validates that a parsed JSON value is a non-null, non-array object dictionary.
 *
 * Distinct Guard Guarantee:
 * - Structural validation is decoupled from field-level schema validation.
 * - Rejects bare JSON arrays (`[]`), bare strings (`""`), bare numbers (`123`),
 *   booleans (`true`/`false`), and `null`.
 * - Rejects before any field (such as `resource`, `accepts`, or `description`)
 *   can be accessed or passed to model-facing untrusted data fences.
 *
 * @throws {InvalidPaymentRequiredShapeError} if `decoded` is not a non-null object or is an array.
 */
export function assertPaymentRequiredShape(decoded: unknown): asserts decoded is PaymentRequired {
  if (decoded === null) {
    throw new InvalidPaymentRequiredShapeError("null");
  }
  if (Array.isArray(decoded)) {
    throw new InvalidPaymentRequiredShapeError("array");
  }
  if (typeof decoded !== "object") {
    throw new InvalidPaymentRequiredShapeError(typeof decoded);
  }
}

/**
 * Decodes the PAYMENT-REQUIRED header from a 402 Response, enforcing both
 * valid JSON syntax and valid top-level object shape.
 *
 * @param res 402 HTTP Response
 * @throws {NoUsablePaymentOptionError} If the header is missing or malformed JSON.
 * @throws {InvalidPaymentRequiredShapeError} If the decoded JSON is the wrong top-level type.
 */
export function decodePaymentRequiredWithShapeGuard(res: Response): PaymentRequired {
  const header = res.headers.get("PAYMENT-REQUIRED") ?? res.headers.get("payment-required");
  if (!header) {
    throw new NoUsablePaymentOptionError("402 response carried no PAYMENT-REQUIRED header.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(base64ToUtf8(header));
  } catch (err) {
    throw new NoUsablePaymentOptionError(
      `Malformed PAYMENT-REQUIRED header: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Enforce top-level container shape before any field lookup occurs
  assertPaymentRequiredShape(decoded);

  return decoded;
}
