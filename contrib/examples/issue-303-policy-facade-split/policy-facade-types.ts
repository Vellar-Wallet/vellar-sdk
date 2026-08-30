/**
 * Structural types shared by the read and write halves of the policy facade.
 *
 * Contributed for issue #303. These mirror the real types in
 * `src/policy-types.ts` and `src/policy-client.ts` structurally rather than
 * importing them, so this example stays self-contained and runnable on its own.
 * When the split moves into `src/`, these aliases collapse to plain imports
 * from the existing modules — nothing here is new API surface.
 */

/** Mirrors `PolicyDefinition` from `src/types.ts`. */
export type PolicyDefinitionLike = Record<string, unknown>;

/** Mirrors `PolicyTemplateInfo` from `src/policy-types.ts`. */
export interface PolicyTemplateInfoLike {
  id: string;
  [key: string]: unknown;
}

/** Mirrors `ValidationResult`. */
export interface ValidationResultLike {
  valid: boolean;
  [key: string]: unknown;
}

/** Mirrors `SimulateResult`. */
export interface SimulateResultLike {
  [key: string]: unknown;
}

/** Mirrors `GeneratedPolicy` — note `status`, which is why generate() is a write. */
export interface GeneratedPolicyLike {
  id: string;
  status: "generated" | "instance_deployed" | "deployed";
  [key: string]: unknown;
}

/** Mirrors `DeployPolicyResult`. */
export interface DeployPolicyResultLike {
  policy: GeneratedPolicyLike;
  contractId: string;
  attachTxHash: string;
}

/** The subset of `PolicyClient` the facade actually uses. */
export interface PolicyClientLike {
  listTemplates(): Promise<PolicyTemplateInfoLike[]>;
  listPolicies(filters?: unknown): Promise<GeneratedPolicyLike[]>;
  validate(definition: PolicyDefinitionLike): Promise<ValidationResultLike>;
  generate(definition: PolicyDefinitionLike): Promise<GeneratedPolicyLike>;
  simulate(policyId: string, wallet: string): Promise<SimulateResultLike>;
  deployInstance(policyId: string, wallet: string): Promise<{ contractId: string }>;
  recordDeployment(
    policyId: string,
    txHash: string,
    contractId?: string,
  ): Promise<GeneratedPolicyLike>;
}

/** Mirrors `PolicyFacadeDeps["requireSession"]`. */
export type RequireSession = () => { accountId: string; keyId?: string };

/**
 * Mirrors `PolicyAttachRuntime` from `src/policy-facade.ts`: the narrow seam
 * the host wires to `kit.addPolicy → kit.sign → backend.submitTransaction`.
 */
export interface PolicyAttachRuntimeLike {
  /** Resume the connected passkey for a keyId without prompting, when possible. */
  resume?(keyId: string): Promise<void>;
  /** Build, passkey-sign, and submit the attach. This is where WebAuthn prompts. */
  attachPolicy(policyContractId: string): Promise<{ hash: string }>;
}
