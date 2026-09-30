// Conformance suite for the x402 guard layer.
//
// Runs every GUARD_VECTORS entry through the real selectRequirements
// implementation and checks the outcome. A second payer (in another repo)
// can import the vectors and run them against its own implementation to
// verify it makes the same decisions.

import { describe, expect, it } from "vitest";
import { selectRequirements } from "./x402-guards";
import {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
} from "./x402-types";
import { GUARD_VECTORS } from "./x402-guards-vectors";

const ERROR_CLASSES: Record<string, new (...args: never[]) => Error> = {
  NoUsablePaymentOptionError,
  DisallowedAssetError,
  MaxAmountExceededError,
  InvalidRequirementsError,
};

describe("guard conformance vectors", () => {
  for (const vector of GUARD_VECTORS) {
    it(vector.name, () => {
      if ("error" in vector.expect) {
        const ErrorClass = ERROR_CLASSES[vector.expect.error];
        if (!ErrorClass) {
          throw new Error(`Unknown error class in vector: ${vector.expect.error}`);
        }
        expect(() =>
          selectRequirements(vector.input, vector.opts, vector.ourCaip2),
        ).toThrow(ErrorClass);
      } else {
        const picked = selectRequirements(vector.input, vector.opts, vector.ourCaip2);
        expect(picked.asset).toBe(vector.expect.asset);
      }
    });
  }
});