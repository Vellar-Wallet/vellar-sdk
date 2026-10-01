// Conformance harness for the x402 guard vectors.
//
// Any implementation of selectRequirements / parseAmount should be able to run
// these vectors against its own code and pass. Swap the imports below to
// conform a different implementation.

import { describe, expect, it } from "vitest";
import { parseAmount, selectRequirements } from "./x402-guards";
import {
  AMOUNT_PARSE_VECTORS,
  GUARD_ERROR_VECTORS,
  GUARD_SELECT_VECTORS,
  type AmountParseVector,
} from "./x402-guards-vectors";
import { InvalidRequirementsError } from "./x402-types";

describe("guard select conformance vectors", () => {
  for (const v of GUARD_SELECT_VECTORS) {
    it(v.name, () => {
      const picked = selectRequirements(v.decoded, v.opts, v.ourCaip2);
      expect(picked).toBe(v.decoded.accepts[v.expectedIndex]);
    });
  }
});

describe("guard error conformance vectors", () => {
  for (const v of GUARD_ERROR_VECTORS) {
    it(v.name, () => {
      expect(() => selectRequirements(v.decoded, v.opts, v.ourCaip2)).toThrow(v.expectedError);
      if (v.messageContains) {
        try {
          selectRequirements(v.decoded, v.opts, v.ourCaip2);
        } catch (e) {
          expect((e as Error).message).toContain(v.messageContains);
        }
      }
    });
  }
});

describe("parseAmount conformance vectors", () => {
  for (const v of AMOUNT_PARSE_VECTORS) {
    it(v.name, () => {
      if (v.expected === InvalidRequirementsError) {
        expect(() => parseAmount(v.input)).toThrow(InvalidRequirementsError);
      } else {
        expect(parseAmount(v.input)).toBe(v.expected);
      }
    });
  }
});