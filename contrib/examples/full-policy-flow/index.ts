/**
 * Reference example: full policy generate and simulate flow with a mocked policy API.
 */

import type {
  PolicyDefinition,
  PolicyTemplateInfo,
  GeneratedPolicy,
  SimulateResult,
} from "../../../src/policy-types";

export interface MockPolicyApi {
  listTemplates(): Promise<PolicyTemplateInfo[]>;
  generate(definition: PolicyDefinition): Promise<GeneratedPolicy>;
  simulate(policyId: string, wallet: string): Promise<SimulateResult>;
  deployInstance(policyId: string, wallet: string): Promise<{ contractId: string }>;
  recordDeployment(policyId: string, txHash: string, contractId?: string): Promise<GeneratedPolicy>;
}

const TEMPLATES: PolicyTemplateInfo[] = [
  {
    type: "spending-limit",
    title: "Daily spending limit",
    description: "Limits total outbound spend per rolling day.",
    enforcement: {
      kind: "policy-contract",
      wasmHash: "a".repeat(64),
      constructorArgs: { dailyLimitStroops: "1000000000", windowSeconds: 86400 },
    },
  },
  {
    type: "signer-limits",
    title: "Signer limits",
    description: "Enforces on-chain signer thresholds.",
    enforcement: { kind: "signer-limits" },
  },
];

const POLICIES = new Map<string, GeneratedPolicy>();

export function createMockPolicyApi(): MockPolicyApi {
  return {
    async listTemplates() {
      return TEMPLATES;
    },

    async generate(definition) {
      const policyId = `policy-${definition.type || "custom"}-${Date.now()}`;
      const policy: GeneratedPolicy = {
        id: policyId,
        createdAt: new Date().toISOString(),
        status: "generated",
        definition,
        policyHash: "b".repeat(64),
        manifest: {
          template: definition.type || "custom",
          enforcement: { kind: "policy-contract", wasmHash: "a".repeat(64) },
          network: "testnet",
        },
      };
      POLICIES.set(policyId, policy);
      return policy;
    },

    async simulate(policyId, wallet) {
      // Example: reject when wallet starts with "GZZZ", accept otherwise.
      if (wallet.startsWith("GZZZ")) {
        return { ok: false, error: "simulated_failure" };
      }
      return { ok: true, minResourceFee: "100000" };
    },

    async deployInstance(policyId, wallet) {
      if (!POLICIES.has(policyId)) {
        throw new Error(`policy ${policyId} not generated`);
      }
      return { contractId: `C${policyId}`.slice(0, 56) };
    },

    async recordDeployment(policyId, txHash, contractId) {
      const existing = POLICIES.get(policyId);
      if (!existing) throw new Error(`policy ${policyId} not generated`);
      const policy: GeneratedPolicy = {
        ...existing,
        status: "deployed",
        instance: { contractId: contractId || "", txHash, deployedAt: new Date().toISOString() },
        deployment: { contractId, txHash, deployedAt: new Date().toISOString() },
      };
      POLICIES.set(policyId, policy);
      return policy;
    },
  };
}