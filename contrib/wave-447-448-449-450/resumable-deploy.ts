import type { PolicyAttachRuntime } from "../../src/policy-facade";
import type { PolicyClient } from "../../src/policy-client";
import type { DeployPolicyResult, GeneratedPolicy } from "../../src/policy-types";
import { PolicyApiError } from "../../src/policy-types";

// Issue #447: Make policy deploy resumable after a lost attach response.
//
// If the process dies between the attach landing on-chain and the record call
// succeeding, the policy is attached but not recorded. Re-running deploy from
// the start would deploy a second instance and prompt for a second passkey
// signature. This wrapper adds:
//
//   - A resume path from a known attach tx hash (record step only)
//   - Retry on retryable PolicyApiError for deploy-instance and record steps
//   - DeployPolicyError surfaces contractId + attachHash for callers to resume
//   - The passkey prompt is never issued twice for one logical deploy

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 500;

/** Thrown when deploy fails after the instance has been deployed (and possibly
 * after the attach has landed on-chain). Carries enough state for resume. */
export class DeployPolicyError extends Error {
  readonly contractId: string;
  readonly attachHash?: string;
  readonly cause?: Error;

  constructor(message: string, contractId: string, attachHash?: string, cause?: Error) {
    super(message);
    this.name = "DeployPolicyError";
    this.contractId = contractId;
    this.attachHash = attachHash;
    this.cause = cause;
  }
}

async function retryIfRetryable<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err instanceof PolicyApiError && err.retryable && attempt < MAX_RETRY_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export interface ResumableDeployDeps {
  client: PolicyClient;
  attach: PolicyAttachRuntime;
  requireSession(): { accountId: string; keyId?: string };
}

/** Run the full deploy flow with resume capability and retry on retryable errors. */
export async function resumableDeploy(
  deps: ResumableDeployDeps,
  policyId: string,
): Promise<DeployPolicyResult> {
  const session = deps.requireSession();

  let contractId: string;
  // 1. server-side, sponsor-funded instance deploy bound to the wallet.
  // Retry on retryable (503 / transport) errors — nothing was decided yet.
  const result = await retryIfRetryable(() =>
    deps.client.deployInstance(policyId, session.accountId),
  );
  contractId = result.contractId;

  let attachHash: string | undefined;
  try {
    // 2. passkey-sign the attach (the ONLY prompt).
    // Do NOT retry this step — retrying would re-prompt the user's passkey,
    // which is the exact cost this module exists to avoid.
    if (session.keyId && deps.attach.resume) await deps.attach.resume(session.keyId);
    const attachResult = await deps.attach.attachPolicy(contractId);
    attachHash = attachResult.hash;
  } catch (err) {
    throw new DeployPolicyError(
      "Policy attach failed. Use resumeDeploy() with the contractId to retry the record step once the attach lands on-chain.",
      contractId,
      undefined,
      err instanceof Error ? err : undefined,
    );
  }

  try {
    // 3. record the completed attach. Retry on retryable errors.
    const policy = await retryIfRetryable(() =>
      deps.client.recordDeployment(policyId, attachHash!, contractId),
    );
    return { policy, contractId, attachTxHash: attachHash! };
  } catch (err) {
    throw new DeployPolicyError(
      "Policy attach succeeded but recording failed. Use resumeDeploy() with the attachHash to complete the record step.",
      contractId,
      attachHash,
      err instanceof Error ? err : undefined,
    );
  }
}

/** Resume a deploy from a known attach tx hash — performs only the record
 * step, without issuing a passkey prompt. Use this when resumableDeploy()
 * threw a DeployPolicyError with an attachHash. */
export async function resumeDeploy(
  client: PolicyClient,
  policyId: string,
  attachTxHash: string,
  contractId?: string,
): Promise<DeployPolicyResult> {
  const policy = await retryIfRetryable(() =>
    client.recordDeployment(policyId, attachTxHash, contractId),
  );
  return { policy, contractId: contractId ?? "", attachTxHash };
}