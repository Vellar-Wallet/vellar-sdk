// Contract tests between x402-client and vellar-facilitator responses — issue #266.
//
// Defines runtime validators for the contract shape of each facilitator endpoint
// (GET /supported, PAYMENT-REQUIRED header, PAYMENT-RESPONSE settle result) and
// verifies recorded/mocked payloads comply with the expected schema.
//
// These tests are pure JavaScript — no external schema library — and run via the
// project's existing vitest suite without any additional dependencies.
//
// Contributed as per contrib/ rules.

import { describe, expect, it } from "vitest";

// ── Schema validator functions ────────────────────────────────────────────────

function validateSupportedResponse(payload: unknown): void {
  if (typeof payload !== "object" || payload === null) throw new Error("Payload must be an object");
  const p = payload as Record<string, unknown>;
  if (typeof p.x402Version !== "number") throw new Error("x402Version must be a number");
  if (!Array.isArray(p.schemes) || p.schemes.some((s) => typeof s !== "string"))
    throw new Error("schemes must be an array of strings");
  if (!Array.isArray(p.networks) || p.networks.some((n) => typeof n !== "string"))
    throw new Error("networks must be an array of strings");
  if (!Array.isArray(p.extensions) || p.extensions.some((e) => typeof e !== "string"))
    throw new Error("extensions must be an array of strings");
  if (p.verifiers !== undefined && (!Array.isArray(p.verifiers) || p.verifiers.some((v) => typeof v !== "string")))
    throw new Error("verifiers must be an array of strings if present");
  if (p.settlers !== undefined && (!Array.isArray(p.settlers) || p.settlers.some((s) => typeof s !== "string")))
    throw new Error("settlers must be an array of strings if present");
}

function validatePaymentRequirements(req: unknown): void {
  if (typeof req !== "object" || req === null) throw new Error("Requirement must be an object");
  const r = req as Record<string, unknown>;
  if (typeof r.scheme !== "string") throw new Error("scheme must be a string");
  if (typeof r.network !== "string") throw new Error("network must be a string");
  if (typeof r.asset !== "string") throw new Error("asset must be a string");
  if (typeof r.amount !== "string") throw new Error("amount must be a string");
  if (typeof r.payTo !== "string") throw new Error("payTo must be a string");
  if (r.maxTimeoutSeconds !== undefined && typeof r.maxTimeoutSeconds !== "number")
    throw new Error("maxTimeoutSeconds must be a number if present");
  if (r.extra !== undefined) {
    if (typeof r.extra !== "object" || r.extra === null) throw new Error("extra must be an object");
    const extra = r.extra as Record<string, unknown>;
    if (extra.areFeesSponsored !== undefined && typeof extra.areFeesSponsored !== "boolean")
      throw new Error("extra.areFeesSponsored must be a boolean if present");
  }
}

function validatePaymentRequired(payload: unknown): void {
  if (typeof payload !== "object" || payload === null) throw new Error("Payload must be an object");
  const p = payload as Record<string, unknown>;
  if (typeof p.x402Version !== "number") throw new Error("x402Version must be a number");
  if (p.error !== undefined && typeof p.error !== "string") throw new Error("error must be a string if present");
  if (!Array.isArray(p.accepts)) throw new Error("accepts must be an array");
  (p.accepts as unknown[]).forEach(validatePaymentRequirements);
  if (p.resource !== undefined) {
    const res = p.resource as Record<string, unknown>;
    if (typeof res !== "object" || res === null) throw new Error("resource must be an object");
    if (typeof res.url !== "string") throw new Error("resource.url must be a string");
    if (res.description !== undefined && typeof res.description !== "string")
      throw new Error("resource.description must be a string if present");
    if (res.mimeType !== undefined && typeof res.mimeType !== "string")
      throw new Error("resource.mimeType must be a string if present");
  }
}

function validateSettleResult(payload: unknown): void {
  if (typeof payload !== "object" || payload === null) throw new Error("Payload must be an object");
  const p = payload as Record<string, unknown>;
  if (p.success !== undefined && typeof p.success !== "boolean") throw new Error("success must be a boolean if present");
  if (p.transaction !== undefined && typeof p.transaction !== "string") throw new Error("transaction must be a string if present");
  if (p.payer !== undefined && typeof p.payer !== "string") throw new Error("payer must be a string if present");
  if (p.errorReason !== undefined && typeof p.errorReason !== "string") throw new Error("errorReason must be a string if present");
  if (p.network !== undefined && typeof p.network !== "string") throw new Error("network must be a string if present");
}

// ── Contract tests against mocked/recorded facilitator responses ──────────────

describe("vellar-facilitator contract schemas", () => {
  describe("GET /supported response contract", () => {
    it("validates a standard /supported response payload", () => {
      const payload = {
        x402Version: 2,
        schemes: ["exact", "upto"],
        networks: ["stellar:testnet", "stellar:pubnet"],
        extensions: ["bazaar"],
      };
      expect(() => validateSupportedResponse(payload)).not.toThrow();
    });

    it("rejects a payload with a missing required field", () => {
      expect(() => validateSupportedResponse({ x402Version: 2, schemes: ["exact"] })).toThrow();
    });
  });

  describe("PAYMENT-REQUIRED header contract", () => {
    it("validates a full challenge payload with sponsored fees", () => {
      const payload = {
        x402Version: 2,
        error: "Payment required",
        accepts: [
          {
            scheme: "exact",
            network: "stellar:testnet",
            asset: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND",
            amount: "1000000",
            payTo: "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A",
            maxTimeoutSeconds: 120,
            extra: { areFeesSponsored: true },
          },
        ],
      };
      expect(() => validatePaymentRequired(payload)).not.toThrow();
    });

    it("validates a minimal challenge payload (no optional fields)", () => {
      const payload = {
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "stellar:testnet",
            asset: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND",
            amount: "500000",
            payTo: "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A",
          },
        ],
      };
      expect(() => validatePaymentRequired(payload)).not.toThrow();
    });

    it("rejects a payload where amount is not a string", () => {
      const payload = {
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "stellar:testnet",
            asset: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND",
            amount: 1000000, // number, not string
            payTo: "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A",
          },
        ],
      };
      expect(() => validatePaymentRequired(payload)).toThrow("amount must be a string");
    });
  });

  describe("PAYMENT-RESPONSE (settlement) contract", () => {
    it("validates a successful settlement payload", () => {
      const payload = {
        success: true,
        transaction: "1925c83c1925c83d1925c83e1925c83f1925c8401925c8411925c8421925c843",
        payer: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        network: "stellar:testnet",
      };
      expect(() => validateSettleResult(payload)).not.toThrow();
    });

    it("validates a failed settlement payload (empty transaction, no hash)", () => {
      const payload = {
        success: false,
        errorReason: "settle_exact_stellar_transaction_submission_failed",
        transaction: "",
        network: "stellar:testnet",
      };
      expect(() => validateSettleResult(payload)).not.toThrow();
    });

    it("rejects a payload with a non-boolean success field", () => {
      expect(() => validateSettleResult({ success: "yes", transaction: "abc" })).toThrow(
        "success must be a boolean if present",
      );
    });
  });
});
