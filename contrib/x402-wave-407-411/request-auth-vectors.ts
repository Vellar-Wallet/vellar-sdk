// Conformance vectors + verifier contract for SDK → facilitator request
// signatures (#407). Same reasoning as src/x402-untrusted-vectors.ts: two
// implementations of a security-relevant format drift, and the drift is
// invisible until a replay or a mismatched canonical string is accepted.
//
// This file is dependency-free so a facilitator can copy it (or, once
// lifted, import `vellar-sdk/x402-request-auth-vectors`) without pulling
// Web Crypto.

import {
  canonicalRequestString,
  verifyFacilitatorRequest,
} from "../../src/x402-request-auth";

/** The written verifier contract a compliant facilitator must implement. */
export const REQUEST_AUTH_VERIFIER_CONTRACT = Object.freeze({
  algorithm: "HMAC-SHA256",
  /** Field order of the canonical string. Changing it is a breaking change. */
  canonicalFieldOrder: ["method", "path", "timestamp", "nonce", "body"] as const,
  separator: "\n",
  /** How an omitted body is represented — empty string, never "undefined". */
  absentBody: "",
  methodEncoding: "uppercase ASCII",
  /** Maximum |now − timestamp| a compliant verifier may accept, in seconds. */
  maxTimestampSkewSeconds: 300,
  /** Nonces must be remembered for at least this many seconds. */
  nonceTrackingWindowSeconds: 300,
  /** Required behaviour for a nonce already seen inside the window. */
  replayedNonce: "reject" as const,
});

export const REQUEST_AUTH_MAX_SKEW_SECONDS =
  REQUEST_AUTH_VERIFIER_CONTRACT.maxTimestampSkewSeconds;
export const REQUEST_AUTH_NONCE_WINDOW_SECONDS =
  REQUEST_AUTH_VERIFIER_CONTRACT.nonceTrackingWindowSeconds;

export interface RequestAuthVector {
  name: string;
  method: string;
  path: string;
  body: string;
  timestamp: string;
  nonce: string;
  secret: string;
  keyId: string;
  /** Canonical string the verifier must reconstruct. */
  canonical: string;
  /** Full `X-Vellar-Signature` value (`HMAC-SHA256 <base64>`). */
  signature: string;
  rationale: string;
}

const VECTOR_SECRET = "test-shared-secret";
const VECTOR_KEY_ID = "key-abc";
const VECTOR_TIMESTAMP = "1754006400"; // 2026-08-01T00:00:00.000Z
const VECTOR_NONCE = "0102030405060708090a0b0c0d0e0f10";

/**
 * Each vector is an input plus the expected signature. An independent
 * verifier reconstructs `canonical` and HMAC-SHA256s it with `secret`;
 * the result must match `signature`.
 *
 * Canonical construction (frozen): uppercase(method) + "\\n" + path + "\\n"
 * + timestamp + "\\n" + nonce + "\\n" + body. Absent body is "".
 */
export const REQUEST_AUTH_VECTORS: readonly RequestAuthVector[] = Object.freeze([
  {
    name: "post-verify-json-body",
    method: "POST",
    path: "/verify",
    body: "{}",
    timestamp: VECTOR_TIMESTAMP,
    nonce: VECTOR_NONCE,
    secret: VECTOR_SECRET,
    keyId: VECTOR_KEY_ID,
    canonical: `POST\n/verify\n${VECTOR_TIMESTAMP}\n${VECTOR_NONCE}\n{}`,
    signature: "HMAC-SHA256 Ng311Tl+p2o1fdVRk46OlWJ8C3pYHKKtLp19X1q+4WM=",
    rationale:
      "The common paid-retry shape: POST, a path the route matches on, JSON body.",
  },
  {
    name: "get-settle-empty-body",
    method: "GET",
    path: "/settle",
    body: "",
    timestamp: VECTOR_TIMESTAMP,
    nonce: VECTOR_NONCE,
    secret: VECTOR_SECRET,
    keyId: VECTOR_KEY_ID,
    canonical: `GET\n/settle\n${VECTOR_TIMESTAMP}\n${VECTOR_NONCE}\n`,
    signature: "HMAC-SHA256 SG82eXrcH++QXOlIPwGuYTIy83LQB8Tm92Z+HgJ1otI=",
    rationale:
      "An absent body is the empty final segment (trailing newline), not omitted.",
  },
  {
    name: "method-is-uppercased",
    method: "post",
    path: "/verify",
    body: '{"x":1}',
    timestamp: VECTOR_TIMESTAMP,
    nonce: VECTOR_NONCE,
    secret: VECTOR_SECRET,
    keyId: VECTOR_KEY_ID,
    canonical: `POST\n/verify\n${VECTOR_TIMESTAMP}\n${VECTOR_NONCE}\n{"x":1}`,
    signature: "HMAC-SHA256 l7wrmnv/RW3ZhN7szv5K0ZfzjjoNtQp3QS0rjKuw5uc=",
    rationale:
      "The verifier must uppercase the method before assembling the canonical string.",
  },
  {
    name: "different-nonce-changes-signature",
    method: "GET",
    path: "/status",
    body: "",
    timestamp: VECTOR_TIMESTAMP,
    nonce: "abc",
    secret: VECTOR_SECRET,
    keyId: VECTOR_KEY_ID,
    canonical: `GET\n/status\n${VECTOR_TIMESTAMP}\nabc\n`,
    signature: "HMAC-SHA256 SIHjlKgEL2bqbeqldF5yZuACAeSwMx87RyQSxS0Z75s=",
    rationale:
      "Nonce is in the signed set; a replayed or substituted nonce must not verify.",
  },
]);

/**
 * Verify plus the required replay window. The SDK's verifyFacilitatorRequest
 * checks timestamp skew but does not track nonces — a compliant facilitator
 * MUST. Replay is checked AFTER the signature so an attacker cannot probe
 * the nonce store with a forged signature.
 */
export async function verifyWithReplayWindow(
  secret: string,
  headers: { keyId: string; timestamp: string; nonce: string; signature: string },
  request: { method: string; path: string; body?: string },
  opts: { now?: () => number; seenNonces: Set<string> },
): Promise<boolean> {
  const ok = await verifyFacilitatorRequest(secret, headers, request, {
    now: opts.now,
    toleranceSeconds: REQUEST_AUTH_MAX_SKEW_SECONDS,
  });
  if (!ok) return false;
  if (opts.seenNonces.has(headers.nonce)) return false;
  opts.seenNonces.add(headers.nonce);
  return true;
}

/** Re-export so a vector consumer and the signer share one construction. */
export { canonicalRequestString };
