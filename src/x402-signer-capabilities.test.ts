// Pure-logic tests for scoped capability checks (#224): rule evaluation,
// validation, and denial. Signer WIRING (does createSessionKeySigner /
// createPasskeyX402Signer actually enforce these before signing) is tested in
// x402-signer.test.ts, matching how x402-guards vs x402-client split.

import { describe, expect, it } from "vitest";
import {
  assertCapability,
  assertValidCapabilityRules,
  CapabilityDeniedError,
  evaluateCapability,
  InvalidCapabilityRuleError,
} from "./x402-signer-capabilities";

const TOKEN_A = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const TOKEN_B = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("evaluateCapability", () => {
  it("permits everything when no rules are configured (opt-in scoping)", () => {
    expect(evaluateCapability([], { resourceType: TOKEN_A, action: "transfer" })).toBe(true);
  });

  it("permits an exact resourceType + action match", () => {
    const rules = [{ resourceType: TOKEN_A, action: "transfer" }];
    expect(evaluateCapability(rules, { resourceType: TOKEN_A, action: "transfer" })).toBe(true);
  });

  it("denies a different resourceType", () => {
    const rules = [{ resourceType: TOKEN_A, action: "transfer" }];
    expect(evaluateCapability(rules, { resourceType: TOKEN_B, action: "transfer" })).toBe(false);
  });

  it("denies a different action", () => {
    const rules = [{ resourceType: TOKEN_A, action: "transfer" }];
    expect(evaluateCapability(rules, { resourceType: TOKEN_A, action: "burn" })).toBe(false);
  });

  it("a wildcard action permits any action on the named resource", () => {
    const rules = [{ resourceType: TOKEN_A, action: "*" }];
    expect(evaluateCapability(rules, { resourceType: TOKEN_A, action: "burn" })).toBe(true);
    expect(evaluateCapability(rules, { resourceType: TOKEN_B, action: "burn" })).toBe(false);
  });

  it("a wildcard resourceType permits the named action on any resource", () => {
    const rules = [{ resourceType: "*", action: "transfer" }];
    expect(evaluateCapability(rules, { resourceType: TOKEN_A, action: "transfer" })).toBe(true);
    expect(evaluateCapability(rules, { resourceType: TOKEN_A, action: "burn" })).toBe(false);
  });

  it("a fully wildcard rule permits everything", () => {
    const rules = [{ resourceType: "*", action: "*" }];
    expect(evaluateCapability(rules, { resourceType: TOKEN_B, action: "anything" })).toBe(true);
  });

  it("matches when ANY rule in a multi-rule set permits (OR semantics)", () => {
    const rules = [
      { resourceType: TOKEN_A, action: "transfer" },
      { resourceType: TOKEN_B, action: "burn" },
    ];
    expect(evaluateCapability(rules, { resourceType: TOKEN_B, action: "burn" })).toBe(true);
    expect(evaluateCapability(rules, { resourceType: TOKEN_B, action: "transfer" })).toBe(false);
  });
});

describe("assertCapability", () => {
  it("does not throw when permitted", () => {
    expect(() =>
      assertCapability([{ resourceType: TOKEN_A, action: "transfer" }], {
        resourceType: TOKEN_A,
        action: "transfer",
      }),
    ).not.toThrow();
  });

  it("throws CapabilityDeniedError, carrying the request and rules, when denied", () => {
    const rules = [{ resourceType: TOKEN_A, action: "transfer" }];
    try {
      assertCapability(rules, { resourceType: TOKEN_B, action: "transfer" });
      expect.fail("expected assertCapability to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CapabilityDeniedError);
      const denied = err as CapabilityDeniedError;
      expect(denied.request).toEqual({ resourceType: TOKEN_B, action: "transfer" });
      expect(denied.rules).toBe(rules);
      expect(denied.message).toMatch(/transfer/);
      expect(denied.message).toMatch(TOKEN_B);
    }
  });
});

describe("assertValidCapabilityRules", () => {
  it("accepts an empty rule set", () => {
    expect(() => assertValidCapabilityRules([])).not.toThrow();
  });

  it("accepts valid contract ids and symbols, including wildcards", () => {
    expect(() =>
      assertValidCapabilityRules([
        { resourceType: TOKEN_A, action: "transfer" },
        { resourceType: "*", action: "*" },
      ]),
    ).not.toThrow();
  });

  it("rejects a resourceType that is not a contract id or wildcard", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: "not-a-contract", action: "transfer" }]),
    ).toThrow(InvalidCapabilityRuleError);
  });

  it("rejects a G-address as resourceType (must be a contract, C…)", () => {
    expect(() =>
      assertValidCapabilityRules([
        { resourceType: "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU", action: "*" },
      ]),
    ).toThrow(InvalidCapabilityRuleError);
  });

  it("rejects an action containing invalid characters", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: TOKEN_A, action: "trans-fer!" }]),
    ).toThrow(InvalidCapabilityRuleError);
  });

  it("rejects an action longer than 32 characters", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: TOKEN_A, action: "a".repeat(33) }]),
    ).toThrow(InvalidCapabilityRuleError);
  });
});
