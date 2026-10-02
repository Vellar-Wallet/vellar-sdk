import { describe, expect, it } from "vitest";
import {
  AgentVerificationError,
  verifyAgentSignerGrants,
} from "./agent-verification.js";

describe("verifyAgentSignerGrants (Issue #424)", () => {
  const signerAddress = "GCXYZ...";
  const usdcAddress = "CUSDC...";
  const policyAddress = "CPOLICY...";

  it("succeeds when grants and policies match on-chain state exactly", () => {
    expect(() =>
      verifyAgentSignerGrants(
        {
          signerAddress,
          allowedTokens: [usdcAddress],
          policies: [policyAddress],
        },
        [
          {
            address: signerAddress,
            allowedTokens: [usdcAddress],
            policies: [policyAddress],
          },
        ],
      ),
    ).not.toThrow();
  });

  it("throws absent error when signer is missing on-chain", () => {
    expect(() =>
      verifyAgentSignerGrants(
        { signerAddress, allowedTokens: [usdcAddress] },
        [],
      ),
    ).toThrowError(AgentVerificationError);
  });

  it("detects dangerous more_permissive deviation when policy is dropped", () => {
    try {
      verifyAgentSignerGrants(
        {
          signerAddress,
          allowedTokens: [usdcAddress],
          policies: [policyAddress],
        },
        [
          {
            address: signerAddress,
            allowedTokens: [usdcAddress],
            policies: [], // Policy missing!
          },
        ],
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AgentVerificationError);
      const err = e as AgentVerificationError;
      expect(err.details.direction).toBe("more_permissive");
      expect(err.message).toContain("DANGEROUS");
      expect(err.message).toContain("Operator MUST revoke this signer immediately");
    }
  });

  it("detects dangerous more_permissive deviation when extra token is granted", () => {
    try {
      verifyAgentSignerGrants(
        {
          signerAddress,
          allowedTokens: [usdcAddress],
        },
        [
          {
            address: signerAddress,
            allowedTokens: [usdcAddress, "CUNAUTHORIZED..."],
            policies: [],
          },
        ],
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AgentVerificationError);
      const err = e as AgentVerificationError;
      expect(err.details.direction).toBe("more_permissive");
    }
  });

  it("detects less_permissive deviation when token grant is missing", () => {
    try {
      verifyAgentSignerGrants(
        {
          signerAddress,
          allowedTokens: [usdcAddress, "CXLM..."],
        },
        [
          {
            address: signerAddress,
            allowedTokens: [usdcAddress],
            policies: [],
          },
        ],
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AgentVerificationError);
      const err = e as AgentVerificationError;
      expect(err.details.direction).toBe("less_permissive");
    }
  });
});
