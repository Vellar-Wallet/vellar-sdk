/**
 * Issue #255: Strict Input Validation for x402-Untrusted Vectors.
 */

export function validateUntrustedPayload(data: unknown): { isValid: boolean; error?: string } {
  if (typeof data !== "object" || data === null) {
    return { isValid: false, error: "Payload must be a non-null object" };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.nonce !== "string" || obj.nonce.length < 16) {
    return { isValid: false, error: "Missing or insecure nonce" };
  }

  if (typeof obj.body === "string") {
    // Check for control characters, bidi overrides and fake fence lookalikes
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|\p{Cf}/u.test(obj.body)) {
      return { isValid: false, error: "Malicious control/format characters detected" };
    }
  }

  return { isValid: true };
}
