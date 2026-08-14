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

/** Constructor args for the verified-recipient policy contract: each instance
 * binds to the attestation registry it consults inside __check_auth. */
export interface VerifiedRecipientConstructor {
  registry: string;
}

/** How a template is enforced on-chain — honestly labelled so integrators (and
 * their users) know what actually protects the account, not just marketing. */
export type Enforcement =
  | {
      kind: "policy-contract";
      wasmHash: string;
      constructorArgs?: SpendingConstructor | VerifiedRecipientConstructor;
    }
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
  /**
   * Whether retrying the same request could succeed.
   *
   * Security audit V-10 (wallet-side RA-11-E). `/policies/deploy` has two
   * failure modes with OPPOSITE correct responses, and they were previously
   * indistinguishable to a caller holding this error:
   *
   *   503 attach_unconfirmed — the chain is unreachable or the tx is still
   *                            pending. NOT a failure. The record is not
   *                            stamped. RETRY.
   *   422 attach_mismatch    — the claim is a lie. The record is not stamped.
   *                            DO NOT RETRY; retrying repeats the lie.
   *
   * A caller that retried on any error would retry the lie; one that treated
   * every error as terminal would abandon a recoverable deploy. Branching on
   * `status` was possible but nothing said which way, so both mistakes were
   * equally easy to make.
   *
   * `0` is the transport failure this client raises when `fetch` itself throws,
   * and is retryable for the same reason a 503 is: nothing was decided.
   */
  readonly retryable: boolean;

  constructor(message: string, status: number, errors?: string[]) {
    super(message);
    this.name = "PolicyApiError";
    this.status = status;
    this.errors = errors;
    this.retryable = isRetryableStatus(status);
  }
}

/**
 * Retryable: the request reached no decision. Terminal: the server decided, and
 * the answer will not change by asking again.
 *
 * 4xx are terminal by definition — the request itself is the problem — with 408
 * and 429 excepted because those say "not now" rather than "not ever".
 */
function isRetryableStatus(status: number): boolean {
  if (status === 0) return true; // transport failure; nothing was decided
  if (status === 408 || status === 429) return true;
  return status >= 500;
}
