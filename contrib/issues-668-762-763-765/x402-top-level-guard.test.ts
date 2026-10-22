import { describe, expect, it, vi } from "vitest";
import { utf8ToBase64 } from "../../src/x402-guards.js";
import { NoUsablePaymentOptionError } from "../../src/x402-types.js";
import * as untrustedFence from "../../src/x402-untrusted.js";
import {
  TOP_LEVEL_JSON_SHAPE_VECTORS,
  type TopLevelJsonShapeVector,
} from "./x402-top-level-vectors.js";
import {
  assertPaymentRequiredShape,
  decodePaymentRequiredWithShapeGuard,
  InvalidPaymentRequiredShapeError,
} from "./x402-top-level-guard.js";

function make402Response(bodyString: string): Response {
  return new Response("{}", {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": utf8ToBase64(bodyString),
    },
  });
}

describe("x402 top-level JSON shape validation (#668)", () => {
  describe("assertPaymentRequiredShape unit tests", () => {
    it.each(TOP_LEVEL_JSON_SHAPE_VECTORS)(
      "rejects $name ($type) with InvalidPaymentRequiredShapeError",
      (vector: TopLevelJsonShapeVector) => {
        const decoded = JSON.parse(vector.payload);

        expect(() => assertPaymentRequiredShape(decoded)).toThrow(
          InvalidPaymentRequiredShapeError,
        );
        expect(() => assertPaymentRequiredShape(decoded)).toThrow(
          NoUsablePaymentOptionError,
        );
        expect(() => assertPaymentRequiredShape(decoded)).toThrow(
          /PAYMENT-REQUIRED header must decode to a JSON object/,
        );
      },
    );

    it("accepts a valid object dictionary without throwing", () => {
      const valid = {
        x402Version: 2,
        accepts: [{ scheme: "exact", network: "stellar:testnet", maxAmount: "100" }],
        resource: { description: "Weather report" },
      };
      expect(() => assertPaymentRequiredShape(valid)).not.toThrow();
    });

    it("accepts an empty object dictionary", () => {
      expect(() => assertPaymentRequiredShape({})).not.toThrow();
    });

    it("distinguishes null from object even though typeof null === 'object'", () => {
      expect(() => assertPaymentRequiredShape(null)).toThrow(
        InvalidPaymentRequiredShapeError,
      );
      try {
        assertPaymentRequiredShape(null);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidPaymentRequiredShapeError);
        expect((err as Error).message).toContain("received: null");
      }
    });

    it("distinguishes arrays from plain objects", () => {
      expect(() => assertPaymentRequiredShape([1, 2, 3])).toThrow(
        InvalidPaymentRequiredShapeError,
      );
      try {
        assertPaymentRequiredShape([1, 2, 3]);
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidPaymentRequiredShapeError);
        expect((err as Error).message).toContain("received: array");
      }
    });
  });

  describe("decodePaymentRequiredWithShapeGuard integration tests", () => {
    for (const vector of TOP_LEVEL_JSON_SHAPE_VECTORS) {
      it(`rejects ${vector.name} from Response header before any field access`, () => {
        const res = make402Response(vector.payload);

        expect(() => decodePaymentRequiredWithShapeGuard(res)).toThrow(
          InvalidPaymentRequiredShapeError,
        );
        expect(() => decodePaymentRequiredWithShapeGuard(res)).toThrow(
          NoUsablePaymentOptionError,
        );
      });
    }

    it("never passes malformed payload strings to model-facing untrusted fence", () => {
      const renderSpy = vi.spyOn(untrustedFence, "renderUntrusted");
      const sanitizeSpy = vi.spyOn(untrustedFence, "sanitizeMetadata");

      try {
        const hostileVector = TOP_LEVEL_JSON_SHAPE_VECTORS.find(
          (v) => v.name === "bare-json-string",
        )!;
        const res = make402Response(hostileVector.payload);

        expect(() => decodePaymentRequiredWithShapeGuard(res)).toThrow(
          InvalidPaymentRequiredShapeError,
        );

        // Assert fence rendering is never reached
        expect(renderSpy).not.toHaveBeenCalled();
        expect(sanitizeSpy).not.toHaveBeenCalled();
      } finally {
        renderSpy.mockRestore();
        sanitizeSpy.mockRestore();
      }
    });

    it("decodes a valid PaymentRequired header successfully", () => {
      const validPayload = {
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "stellar:testnet",
            asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
            amount: "1000000",
            payTo: "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3AKSKPD3FN",
          },
        ],
      };
      const res = make402Response(JSON.stringify(validPayload));
      const decoded = decodePaymentRequiredWithShapeGuard(res);

      expect(decoded).toEqual(validPayload);
      expect(decoded.accepts).toHaveLength(1);
    });

    it("throws clear NoUsablePaymentOptionError when 402 carries no header", () => {
      const res = new Response("{}", { status: 402 });
      expect(() => decodePaymentRequiredWithShapeGuard(res)).toThrow(
        "402 response carried no PAYMENT-REQUIRED header.",
      );
    });

    it("throws clear NoUsablePaymentOptionError on non-JSON syntax error", () => {
      const res = make402Response("NOT-JSON-AT-ALL{[[");
      expect(() => decodePaymentRequiredWithShapeGuard(res)).toThrow(
        /Malformed PAYMENT-REQUIRED header/,
      );
    });
  });
});
