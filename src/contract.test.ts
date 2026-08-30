import { describe, expect, it } from "vitest";

// Plain validator functions to assert contract schemas without external dependencies

export function validateSupportedResponse(payload: any) {
  if (typeof payload !== "object" || payload === null) throw new Error("Payload must be an object");
  if (typeof payload.x402Version !== "number") throw new Error("x402Version must be a number");
  if (!Array.isArray(payload.schemes) || payload.schemes.some((s: any) => typeof s !== "string")) {
    throw new Error("schemes must be an array of strings");
  }
  if (!Array.isArray(payload.networks) || payload.networks.some((n: any) => typeof n !== "string")) {
    throw new Error("networks must be an array of strings");
  }
  if (!Array.isArray(payload.extensions) || payload.extensions.some((e: any) => typeof e !== "string")) {
    throw new Error("extensions must be an array of strings");
  }
  if (payload.verifiers !== undefined && (!Array.isArray(payload.verifiers) || payload.verifiers.some((v: any) => typeof v !== "string"))) {
    throw new Error("verifiers must be an array of strings");
  }
  if (payload.settlers !== undefined && (!Array.isArray(payload.settlers) || payload.settlers.some((s: any) => typeof s !== "string"))) {
    throw new Error("settlers must be an array of strings");
  }
}

export function validatePaymentRequirements(req: any) {
  if (typeof req !== "object" || req === null) throw new Error("Requirement must be an object");
  if (typeof req.scheme !== "string") throw new Error("scheme must be a string");
  if (typeof req.network !== "string") throw new Error("network must be a string");
  if (typeof req.asset !== "string") throw new Error("asset must be a string");
  if (typeof req.amount !== "string") throw new Error("amount must be a string");
  if (typeof req.payTo !== "string") throw new Error("payTo must be a string");
  if (req.maxTimeoutSeconds !== undefined && typeof req.maxTimeoutSeconds !== "number") {
    throw new Error("maxTimeoutSeconds must be a number");
  }
  if (req.extra !== undefined) {
    if (typeof req.extra !== "object" || req.extra === null) throw new Error("extra must be an object");
    if (req.extra.areFeesSponsored !== undefined && typeof req.extra.areFeesSponsored !== "boolean") {
      throw new Error("extra.areFeesSponsored must be a boolean");
    }
  }
}

export function validatePaymentRequired(payload: any) {
  if (typeof payload !== "object" || payload === null) throw new Error("Payload must be an object");
  if (typeof payload.x402Version !== "number") throw new Error("x402Version must be a number");
  if (payload.error !== undefined && typeof payload.error !== "string") {
    throw new Error("error must be a string");
  }
  if (!Array.isArray(payload.accepts)) throw new Error("accepts must be an array");
  payload.accepts.forEach(validatePaymentRequirements);
  if (payload.resource !== undefined) {
    const res = payload.resource;
    if (typeof res !== "object" || res === null) throw new Error("resource must be an object");
    if (typeof res.url !== "string") throw new Error("resource.url must be a string");
    if (res.description !== undefined && typeof res.description !== "string") {
      throw new Error("resource.description must be a string");
    }
    if (res.mimeType !== undefined && typeof res.mimeType !== "string") {
      throw new Error("resource.mimeType must be a string");
    }
  }
}

export function validateSettleResult(payload: any) {
  if (typeof payload !== "object" || payload === null) throw new Error("Payload must be an object");
  if (payload.success !== undefined && typeof payload.success !== "boolean") {
    throw new Error("success must be a boolean");
  }
  if (payload.transaction !== undefined && typeof payload.transaction !== "string") {
    throw new Error("transaction must be a string");
  }
  if (payload.payer !== undefined && typeof payload.payer !== "string") {
    throw new Error("payer must be a string");
  }
  if (payload.errorReason !== undefined && typeof payload.errorReason !== "string") {
    throw new Error("errorReason must be a string");
  }
  if (payload.network !== undefined && typeof payload.network !== "string") {
    throw new Error("network must be a string");
  }
}

// Mocked/recorded facilitator responses to verify contract compatibility
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
  });

  describe("PAYMENT-REQUIRED header contract", () => {
    it("validates a standard challenge payload", () => {
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
  });

  describe("PAYMENT-RESPONSE header contract", () => {
    it("validates a successful settlement payload", () => {
      const payload = {
        success: true,
        transaction: "1925c83c1925c83d1925c83e1925c83f1925c8401925c8411925c8421925c843",
        payer: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        network: "stellar:testnet",
      };
      expect(() => validateSettleResult(payload)).not.toThrow();
    });

    it("validates a failed settlement payload", () => {
      const payload = {
        success: false,
        errorReason: "settle_exact_stellar_transaction_submission_failed",
        transaction: "",
        network: "stellar:testnet",
      };
      expect(() => validateSettleResult(payload)).not.toThrow();
    });
  });
});
