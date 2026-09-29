/**
 * agent-verification.ts — Contributor reference implementation for #424.
 *
 * Adds post-mint on-chain verification for agent session keys to ensure
 * deployed authority exactly matches requested grants and catches dangerous divergence.
 */

export type VerificationDirection = "more_permissive" | "less_permissive" | "absent";

export interface AgentVerificationDetails {
  direction: VerificationDirection;
  expectedSigner: string;
  actualSigner?: string;
  expectedTokens: string[];
  actualTokens: string[];
  expectedPolicies: string[];
  actualPolicies: string[];
}

export class AgentVerificationError extends Error {
  readonly name = "AgentVerificationError";
  readonly details: AgentVerificationDetails;

  constructor(details: AgentVerificationDetails) {
    let msg: string;
    if (details.direction === "absent") {
      msg = `On-chain verification failed: signer '${details.expectedSigner}' was not found on the account after minting.`;
    } else if (details.direction === "more_permissive") {
      msg =
        `DANGEROUS: On-chain verification detected MORE permissive authority than requested for signer '${details.expectedSigner}'. ` +
        `Actual tokens: [${details.actualTokens.join(", ")}], Expected: [${details.expectedTokens.join(", ")}]. ` +
        `Actual policies: [${details.actualPolicies.join(", ")}], Expected: [${details.expectedPolicies.join(", ")}]. ` +
        `This key may exist on-chain with unintended authority. Operator MUST revoke this signer immediately.`;
    } else {
      msg =
        `On-chain verification detected less permissive authority than requested for signer '${details.expectedSigner}'. ` +
        `Actual tokens: [${details.actualTokens.join(", ")}], Expected: [${details.expectedTokens.join(", ")}]. ` +
        `Actual policies: [${details.actualPolicies.join(", ")}], Expected: [${details.expectedPolicies.join(", ")}].`;
    }

    super(msg);
    this.details = details;
  }
}

export interface ExpectedAgentGrants {
  signerAddress: string;
  allowedTokens?: string[];
  policies?: string[];
}

export interface OnChainAgentSigner {
  address: string;
  allowedTokens: string[];
  policies: string[];
}

export function verifyAgentSignerGrants(
  expected: ExpectedAgentGrants,
  deployedSigners: OnChainAgentSigner[],
): void {
  const actual = deployedSigners.find((s) => s.address === expected.signerAddress);
  if (!actual) {
    throw new AgentVerificationError({
      direction: "absent",
      expectedSigner: expected.signerAddress,
      expectedTokens: expected.allowedTokens ?? [],
      actualTokens: [],
      expectedPolicies: expected.policies ?? [],
      actualPolicies: [],
    });
  }

  const expTokens = new Set(expected.allowedTokens ?? []);
  const actTokens = new Set(actual.allowedTokens);
  const expPolicies = new Set(expected.policies ?? []);
  const actPolicies = new Set(actual.policies);

  const extraTokens = actual.allowedTokens.filter((t) => !expTokens.has(t));
  const missingTokens = (expected.allowedTokens ?? []).filter((t) => !actTokens.has(t));
  const extraPolicies = actual.policies.filter((p) => !expPolicies.has(p));
  const missingPolicies = (expected.policies ?? []).filter((p) => !actPolicies.has(p));

  // Security critical: extra token allowed or expected policy dropped means more permissive!
  const isMorePermissive = extraTokens.length > 0 || missingPolicies.length > 0;
  const isLessPermissive = missingTokens.length > 0 || extraPolicies.length > 0;

  if (isMorePermissive) {
    throw new AgentVerificationError({
      direction: "more_permissive",
      expectedSigner: expected.signerAddress,
      actualSigner: actual.address,
      expectedTokens: expected.allowedTokens ?? [],
      actualTokens: actual.allowedTokens,
      expectedPolicies: expected.policies ?? [],
      actualPolicies: actual.policies,
    });
  }

  if (isLessPermissive) {
    throw new AgentVerificationError({
      direction: "less_permissive",
      expectedSigner: expected.signerAddress,
      actualSigner: actual.address,
      expectedTokens: expected.allowedTokens ?? [],
      actualTokens: actual.allowedTokens,
      expectedPolicies: expected.policies ?? [],
      actualPolicies: actual.policies,
    });
  }
}
