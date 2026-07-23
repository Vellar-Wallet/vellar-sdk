import type { PolicyDefinition } from "./types";

// Policy domain types for the SDK (idea.md §6.2, §11; technical-doc.md §5.4).
// Mirrors the policy-service API shapes so the wallet-sdk is the single source
// of policy types for both the web app and third-party integrators (the web app
// used to define these locally — now it imports them from here, DRY).

export type { PolicyDefinition };

/** Constructor args for our configurable spending-limit policy contract. */
export interface SpendingConstructor {
  dailyLimitStroops: string;
  windowSeconds: number;
}

/** How a template is enforced on-chain — honestly labelled so integrators (and
 * their users) know what actually protects the account, not just marketing. */
export type Enforcement =
  | { kind: "policy-contract"; wasmHash: string; constructorArgs?: SpendingConstructor }
  | { kind: "signer-limits" }
  | { kind: "none" }
  | { kind: "custom-contract-pending" };

export interface PolicyTemplateInfo {
  type: string;
  title: string;
  description: string;
  enforcement: Enforcement;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface GeneratedPolicy {
  id: string;
  createdAt: string;
  status: "generated" | "instance_deployed" | "deployed";
  definition: PolicyDefinition;
  policyHash: string;
  manifest: { template: string; enforcement: Enforcement; network: "testnet" | "mainnet" };
  instance?: { contractId: string; txHash: string; deployedAt: string };
  deployment?: { contractId?: string; txHash: string; deployedAt: string };
}

export interface SimulateResult {
  ok: boolean;
  minResourceFee?: string;
  error?: string;
}

/** Result of a completed policy attach (deploy → passkey-sign → record). */
export interface DeployPolicyResult {
  policy: GeneratedPolicy;
  contractId: string;
  attachTxHash: string;
}

/** Human summary of a template's on-chain enforcement (honest trust copy). */
export function enforcementLabel(e: Enforcement): string {
  switch (e.kind) {
    case "policy-contract":
      return "Enforced on-chain by a dedicated policy contract deployed for your account (a cumulative rolling-window spending allowance).";
    case "signer-limits":
      return "Enforced by the smart wallet's native signer limits.";
    case "none":
      return "Default single-owner behaviour — no extra on-chain enforcement.";
    case "custom-contract-pending":
      return "Requires a custom policy contract (coming in a later phase).";
  }
}

/** Format stroops as an XLM string for display ("1000000000" → "100"). */
export function stroopsToXlm(stroops: string): string {
  const n = BigInt(stroops);
  const whole = n / 10_000_000n;
  const frac = (n % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Error thrown by the policy API client for non-2xx responses. */
export class PolicyApiError extends Error {
  readonly status: number;
  readonly errors?: string[];
  constructor(message: string, status: number, errors?: string[]) {
    super(message);
    this.name = "PolicyApiError";
    this.status = status;
    this.errors = errors;
  }
}
