/**
 * The write half of the policy facade — every operation with a side effect.
 *
 * Contributed for issue #303. This is the file that exists to be read
 * carefully: everything in it changes state somewhere, and the whole point of
 * the split is that "what can this mutate?" has one place to look.
 *
 * ── What each write actually does ────────────────────────────────────────
 *
 * `generate(definition)` — looks like a pure transform and is not. The gateway
 * persists the artifacts it returns; the result carries a `status` that later
 * moves `generated → instance_deployed → deployed`. Calling it twice creates
 * two policies. It lives here for that reason alone, and it is the counterpart
 * to `validate()` in the read module: same POST shape, opposite side effect.
 *
 * `deploy(policyId)` — the headline, and the only operation in the SDK that
 * triggers a WebAuthn prompt. Three steps, in order:
 *
 *   1. `deployInstance` — server-side, sponsor-funded contract deploy bound to
 *      the wallet. Spends the sponsor's funds.
 *   2. `attachPolicy`   — passkey-signed `kit.addPolicy`, submitted on-chain.
 *      The ONLY passkey prompt in the flow.
 *   3. `recordDeployment` — records the completed attach against the policy.
 *
 * ── Why deploy() is not retryable ────────────────────────────────────────
 *
 * Each step is a real mutation and the sequence is not idempotent. Re-running
 * a failed `deploy()` from the top deploys a SECOND contract instance and
 * prompts for a second signature. There is deliberately no retry here: the
 * caller decides, because only the caller knows whether step 2's prompt was
 * declined (safe to retry) or step 3 merely failed to record an attach that
 * already happened on-chain (must not redeploy — reconcile instead).
 *
 * The step ordering matters for the same reason. Recording before attaching
 * would leave a policy marked deployed that never attached; attaching before
 * deploying the instance has nothing to attach. The order is asserted directly
 * in the tests.
 */

import type {
  PolicyClientLike,
  PolicyDefinitionLike,
  DeployPolicyResultLike,
  GeneratedPolicyLike,
  PolicyAttachRuntimeLike,
  RequireSession,
} from "./policy-facade-types";

/**
 * Thrown when `deploy()` is called on a wallet built without a passkey-attach
 * runtime. Mirrors the error of the same name in `src/policy-facade.ts`.
 */
export class PolicyNotDeployableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyNotDeployableError";
  }
}

/** The mutating surface of the policy facade. */
export interface PolicyWriteOperations {
  /**
   * Validate and generate the deployable artifacts for a definition.
   *
   * A write: the gateway persists what it returns. Calling twice creates two
   * policies.
   */
  generate(definition: PolicyDefinitionLike): Promise<GeneratedPolicyLike>;
  /**
   * Attach a generated policy to the connected wallet.
   *
   * Deploys a contract instance, prompts for a passkey signature, and records
   * the result. Not idempotent — see the module comment.
   */
  deploy(policyId: string): Promise<DeployPolicyResultLike>;
}

export interface PolicyWriteDeps {
  client: PolicyClientLike;
  /** Returns the connected wallet's account id + keyId, or throws if not ready. */
  requireSession: RequireSession;
  /** The passkey-attach runtime. Absent ⇒ `deploy()` throws a clear error. */
  attach?: PolicyAttachRuntimeLike;
}

export function createPolicyWrites(deps: PolicyWriteDeps): PolicyWriteOperations {
  const { client, requireSession, attach } = deps;

  return {
    generate(definition) {
      return client.generate(definition);
    },

    async deploy(policyId) {
      // Resolved first: an unconnected wallet must fail before anything is
      // deployed or signed.
      const session = requireSession();

      if (!attach) {
        // Checked before step 1, so a wallet that cannot complete the flow
        // never spends the sponsor's funds on an instance it can't attach.
        throw new PolicyNotDeployableError(
          "Policy deploy needs a passkey-attach runtime. This wallet was created without one — provide `policyAttach` in the config (or use the web app runtime).",
        );
      }

      // 1. Server-side, sponsor-funded instance deploy bound to the wallet.
      const { contractId } = await client.deployInstance(policyId, session.accountId);

      // 2. Passkey-sign the attach. The ONLY prompt in this flow.
      //    `resume` reuses the connected passkey to avoid a second ceremony;
      //    it is optional, and skipped when the session has no keyId.
      if (session.keyId && attach.resume) await attach.resume(session.keyId);
      const { hash } = await attach.attachPolicy(contractId);

      // 3. Record the completed attach. Last, so nothing is marked deployed
      //    that did not actually attach on-chain.
      const policy = await client.recordDeployment(policyId, hash, contractId);

      return { policy, contractId, attachTxHash: hash };
    },
  };
}
