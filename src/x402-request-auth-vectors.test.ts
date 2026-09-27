// Conformance tests for the request-auth verifier contract (#407).
// Golden signatures are frozen in the vectors module so an independent
// facilitator can import them rather than re-derive this suite.

import { describe, expect, it } from "vitest";
import {
  REQUEST_AUTH_MAX_SKEW_SECONDS,
  REQUEST_AUTH_NONCE_WINDOW_SECONDS,
  canonicalRequestString,
  signFacilitatorRequest,
  verifyFacilitatorRequest,
} from "./x402-request-auth";
import {
  REQUEST_AUTH_VECTORS,
  REQUEST_AUTH_VERIFIER_CONTRACT,
} from "./x402-request-auth-vectors";

describe("REQUEST_AUTH_VERIFIER_CONTRACT", () => {
  it("freezes field order, separator, absent-body encoding, and the replay window", () => {
    expect(REQUEST_AUTH_VERIFIER_CONTRACT.canonicalFieldOrder).toEqual([
      "method",
      "path",
      "timestamp",
      "nonce",
      "body",
    ]);
    expect(REQUEST_AUTH_VERIFIER_CONTRACT.separator).toBe("\n");
    expect(REQUEST_AUTH_VERIFIER_CONTRACT.absentBody).toBe("");
    expect(REQUEST_AUTH_VERIFIER_CONTRACT.maxTimestampSkewSeconds).toBe(
      REQUEST_AUTH_MAX_SKEW_SECONDS,
    );
    expect(REQUEST_AUTH_VERIFIER_CONTRACT.nonceTrackingWindowSeconds).toBe(
      REQUEST_AUTH_NONCE_WINDOW_SECONDS,
    );
    expect(REQUEST_AUTH_VERIFIER_CONTRACT.replayedNonce).toBe("reject");
  });
});

describe("REQUEST_AUTH_VECTORS", () => {
  it("each vector's canonical string matches the spec construction", () => {
    for (const v of REQUEST_AUTH_VECTORS) {
      expect(v.canonical).toBe(
        canonicalRequestString({
          method: v.method,
          path: v.path,
          body: v.body,
          timestamp: v.timestamp,
          nonce: v.nonce,
        }),
      );
      expect(v.canonical.split("\n")).toHaveLength(5);
    }
  });

  it("signFacilitatorRequest reproduces each frozen signature", async () => {
    for (const v of REQUEST_AUTH_VECTORS) {
      const headers = await signFacilitatorRequest(
        {
          keyId: v.keyId,
          secret: v.secret,
          now: () => Number(v.timestamp) * 1000,
          nonce: () => v.nonce,
        },
        { method: v.method, path: v.path, body: v.body },
      );
      expect(headers["X-Vellar-Signature"]).toBe(v.signature);
    }
  });

  it("verifyFacilitatorRequest accepts each vector and rejects a replayed nonce", async () => {
    for (const v of REQUEST_AUTH_VECTORS) {
      const seen = new Set<string>();
      const request = { method: v.method, path: v.path, body: v.body };
      const headers = {
        keyId: v.keyId,
        timestamp: v.timestamp,
        nonce: v.nonce,
        signature: v.signature,
      };
      const now = () => Number(v.timestamp) * 1000;
      expect(await verifyFacilitatorRequest(v.secret, headers, request, { now, seenNonces: seen })).toBe(
        true,
      );
      expect(
        await verifyFacilitatorRequest(v.secret, headers, request, { now, seenNonces: seen }),
      ).toBe(false);
    }
  });
});
