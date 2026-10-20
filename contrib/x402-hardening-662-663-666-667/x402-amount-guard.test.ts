// Issue #663 — a negative challenge amount is refused before signing/budgeting.

import { describe, expect, it, vi } from "vitest";
import { parseAmount, selectRequirements } from "../../src/x402-guards.js";
import { InvalidRequirementsError } from "../../src/x402-types.js";
import { CAIP2_TESTNET, decoded, requirements } from "../../src/x402-test-fixtures.js";
import { AMOUNT_VECTORS } from "./x402-amount-vectors.js";

describe("amount vectors — hostile challenge amounts are refused by the guards", () => {
  for (const v of AMOUNT_VECTORS) {
    it(`${v.name}: parseAmount throws InvalidRequirementsError`, () => {
      expect(() => parseAmount(v.amount)).toThrow(InvalidRequirementsError);
    });

    it(`${v.name}: selectRequirements refuses it before anything is signed`, () => {
      expect(() =>
        selectRequirements(
          decoded([requirements({ amount: v.amount })]),
          { maxAmount: 10n ** 30n },
          CAIP2_TESTNET,
        ),
      ).toThrow(InvalidRequirementsError);
    });
  }

  it("a negative option cannot win 'cheapest' against an honest one", () => {
    const offered = decoded([requirements({ amount: "5000" }), requirements({ amount: "-1" })]);
    expect(() => selectRequirements(offered, { maxAmount: 10n ** 9n }, CAIP2_TESTNET)).toThrow(
      InvalidRequirementsError,
    );
  });

  it("the guard throws before any signer or budget callback could run", () => {
    // selectRequirements is pure: the only side effect available is the throw.
    const signer = vi.fn();
    expect(() =>
      selectRequirements(
        decoded([requirements({ amount: "-1" })]),
        { maxAmount: 10n ** 9n },
        CAIP2_TESTNET,
      ),
    ).toThrow(InvalidRequirementsError);
    expect(signer).not.toHaveBeenCalled();
  });

  it("happy path: a plain positive amount still selects", () => {
    const out = selectRequirements(
      decoded([requirements({ amount: "5000" })]),
      { maxAmount: 10n ** 9n },
      CAIP2_TESTNET,
    );
    expect(out.amount).toBe("5000");
  });
});
