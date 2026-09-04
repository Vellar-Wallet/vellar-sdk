import { describe, expect, it } from "vitest";
import {
  assertValidCapabilityRules,
  CapabilityDeniedError,
  createMockSigner,
  evaluateCapability,
  InvalidCapabilityRuleError,
  type MockSignerConfig,
} from "./experimental-signer-policy-flag";

const WALLET = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
const USDC = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const OTHER = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("assertValidCapabilityRules", () => {
  it("accepts an empty rule set", () => {
    expect(() => assertValidCapabilityRules([])).not.toThrow();
  });

  it("rejects a resourceType that is not a contract id or wildcard", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: "not-a-contract", action: "transfer" }]),
    ).toThrow(InvalidCapabilityRuleError);
  });

  it("rejects an action containing invalid characters", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: USDC, action: "trans-fer!" }]),
    ).toThrow(InvalidCapabilityRuleError);
  });

  it("rejects an action longer than 32 characters", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: USDC, action: "a".repeat(33) }]),
    ).toThrow(InvalidCapabilityRuleError);
  });
});

describe("the experimental flag (strictWildcards)", () => {
  it("accepts wildcard rules when the flag is not set (default, unchanged)", () => {
    expect(() => assertValidCapabilityRules([{ resourceType: "*", action: "*" }])).not.toThrow();
  });

  it("accepts wildcard rules when the flag is explicitly false", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: USDC, action: "*" }], false),
    ).not.toThrow();
  });

  it("rejects a wildcard resourceType when the flag is true", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: "*", action: "transfer" }], true),
    ).toThrow(InvalidCapabilityRuleError);
  });

  it("rejects a wildcard action when the flag is true", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: USDC, action: "*" }], true),
    ).toThrow(InvalidCapabilityRuleError);
  });

  it("still accepts fully explicit rules when the flag is true", () => {
    expect(() =>
      assertValidCapabilityRules([{ resourceType: USDC, action: "transfer" }], true),
    ).not.toThrow();
  });

  it("names the offending rule and the flag in the error message", () => {
    try {
      assertValidCapabilityRules([{ resourceType: USDC, action: "*" }], true);
      expect.fail("expected a throw");
    } catch (err) {
      expect((err as Error).message).toMatch(/experimentalStrictWildcardCapabilities/);
      expect((err as Error).message).toMatch(/wildcard/);
    }
  });
});

describe("evaluateCapability", () => {
  it("permits everything when no rules are configured (opt-in scoping)", () => {
    expect(evaluateCapability([], { resourceType: USDC, action: "transfer" })).toBe(true);
  });

  it("permits an exact resourceType + action match", () => {
    const rules = [{ resourceType: USDC, action: "transfer" }];
    expect(evaluateCapability(rules, { resourceType: USDC, action: "transfer" })).toBe(true);
  });

  it("denies a different resourceType or action", () => {
    const rules = [{ resourceType: USDC, action: "transfer" }];
    expect(evaluateCapability(rules, { resourceType: OTHER, action: "transfer" })).toBe(false);
    expect(evaluateCapability(rules, { resourceType: USDC, action: "burn" })).toBe(false);
  });

  it("honours wildcards in either field", () => {
    expect(
      evaluateCapability([{ resourceType: USDC, action: "*" }], {
        resourceType: USDC,
        action: "burn",
      }),
    ).toBe(true);
    expect(
      evaluateCapability([{ resourceType: "*", action: "transfer" }], {
        resourceType: OTHER,
        action: "transfer",
      }),
    ).toBe(true);
  });
});

describe("createMockSigner: flagged vs unflagged behavior differs", () => {
  const wildcardConfig: MockSignerConfig = {
    address: WALLET,
    capabilities: [{ resourceType: USDC, action: "*" }],
  };

  it("the same wildcard config is accepted unflagged and rejected flagged", () => {
    // Default (flag unset): accepted, and signs.
    const lenient = createMockSigner(wildcardConfig);
    expect(lenient.signInvocation({ resourceType: USDC, action: "burn" })).toContain("signed:");

    // Flagged: the identical config now throws at construction.
    expect(() =>
      createMockSigner({ ...wildcardConfig, experimentalStrictWildcardCapabilities: true }),
    ).toThrow(InvalidCapabilityRuleError);
  });

  it("explicitly setting the flag to false matches default (unflagged) behavior", () => {
    expect(() =>
      createMockSigner({ ...wildcardConfig, experimentalStrictWildcardCapabilities: false }),
    ).not.toThrow();
  });

  it("does not affect a signer whose rules contain no wildcards", () => {
    const signer = createMockSigner({
      address: WALLET,
      capabilities: [{ resourceType: USDC, action: "transfer" }],
      experimentalStrictWildcardCapabilities: true,
    });
    expect(signer.signInvocation({ resourceType: USDC, action: "transfer" })).toBe(
      `signed:transfer@${USDC}`,
    );
  });

  it("does not affect a signer with no capabilities configured at all", () => {
    const signer = createMockSigner({
      address: WALLET,
      experimentalStrictWildcardCapabilities: true,
    });
    // No scoping configured means everything is permitted, flag or not.
    expect(signer.signInvocation({ resourceType: OTHER, action: "anything" })).toContain("signed:");
  });

  it("still enforces the capability check itself under the flag", () => {
    const signer = createMockSigner({
      address: WALLET,
      capabilities: [{ resourceType: USDC, action: "transfer" }],
      experimentalStrictWildcardCapabilities: true,
    });
    expect(() => signer.signInvocation({ resourceType: USDC, action: "burn" })).toThrow(
      CapabilityDeniedError,
    );
  });

  it("exposes the signer address unchanged", () => {
    expect(createMockSigner({ address: WALLET }).address).toBe(WALLET);
  });
});
