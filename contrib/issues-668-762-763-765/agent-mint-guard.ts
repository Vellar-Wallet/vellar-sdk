// Hardened agent key management for wallet.agents (#762, #763, #765).
//
// WHY THIS EXISTS:
// 1. Duplicate policy contract IDs (#762): An agent grant binds a token to a list of
//    policy contracts that co-sign in __check_auth. While an empty policies array is
//    explicitly rejected, duplicate contract IDs in one grant indicate caller confusion
//    (e.g. duplicate spending limits) and must be rejected client-side. The same policy
//    MAY still be used across different token grants within the same mint call.
//
// 2. Past expiresAt dates (#763): MintAgentInput accepts expiresAt as a Date or unix
//    seconds. Minting an already-expired key wastes passkey prompts and transaction fees.
//    The SDK rejects past timestamps client-side with InvalidAgentInputError before
//    triggering any passkey prompt or RPC call.
//
// 3. Revoke idempotency (#765): Calling revoke twice in succession (e.g. following a
//    retry after a transient network timeout) must either succeed as a no-op or fail
//    with a clear, named AgentKeyNotFoundError. It must never throw an unhandled or
//    misleading error that falsely indicates the initial revoke failed on-chain.

import {
  InvalidAgentInputError,
  AgentsNotConfiguredError,
  type AgentKeyRuntime,
  type AgentsFacade,
  type AgentsFacadeDeps,
  type AgentPolicyGrant,
  type MintAgentInput,
  type MintAgentResult,
} from "../../src/agents-facade.js";

const ED25519_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

/**
 * Thrown when attempting to revoke an agent key that is already revoked
 * or does not exist on-chain.
 */
export class AgentKeyNotFoundError extends Error {
  readonly publicKey: string;
  constructor(publicKey: string) {
    super(`Agent key not found or already revoked: ${publicKey}`);
    this.name = "AgentKeyNotFoundError";
    this.publicKey = publicKey;
  }
}

/**
 * Validates that an AgentPolicyGrant has at least one policy and does not
 * list the same policy contract ID more than once.
 *
 * Consistent with empty-array rejection, duplicates within a single grant
 * are explicitly rejected rather than silently deduplicated, catching caller
 * configuration errors early.
 *
 * @throws {InvalidAgentInputError} if policies is empty or contains duplicates.
 */
export function assertNoDuplicatePolicies(grant: AgentPolicyGrant): void {
  if (!grant.policies || grant.policies.length === 0) {
    throw new InvalidAgentInputError(
      `grant for ${grant.token} has no policies — an unrestricted grant is not mintable through wallet.agents`,
    );
  }

  const seen = new Set<string>();
  for (const policy of grant.policies) {
    if (!CONTRACT_ID.test(policy)) {
      throw new InvalidAgentInputError(`policy must be a contract id (C…): ${policy}`);
    }
    if (seen.has(policy)) {
      throw new InvalidAgentInputError(
        `grant for ${grant.token} has duplicate policy: ${policy}`,
      );
    }
    seen.add(policy);
  }
}

/**
 * Validates that `expiresAt` is strictly in the future.
 * Rejects values at or before the current time.
 *
 * @param expiresAt Date or unix seconds
 * @param nowMs Current time in milliseconds (defaults to Date.now())
 * @returns Expiration timestamp in unix seconds, or undefined if not set.
 * @throws {InvalidAgentInputError} if expiresAt is at or before the current time.
 */
export function validateExpiresAt(
  expiresAt: Date | number | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (expiresAt === undefined) return undefined;
  const seconds =
    expiresAt instanceof Date ? Math.floor(expiresAt.getTime() / 1000) : Math.floor(expiresAt);
  const currentSeconds = Math.floor(nowMs / 1000);

  if (!Number.isFinite(seconds) || seconds <= currentSeconds) {
    throw new InvalidAgentInputError("expiresAt must be in the future");
  }
  return seconds;
}

export interface HardenedAgentsFacadeOptions {
  /**
   * Idempotency mode for revoke when called on an already-revoked key:
   * - "noop": Return the existing/sentinel confirmation hash without throwing.
   * - "throw-not-found": Throw `AgentKeyNotFoundError` with a clear message.
   * Default: "noop".
   */
  idempotencyMode?: "noop" | "throw-not-found";
}

/**
 * Creates a hardened `AgentsFacade` implementing the complete guard guarantees:
 * - Rejects duplicate policies within a single grant (#762)
 * - Allows cross-grant policy reuse (#762)
 * - Rejects past expiresAt Date/number before passkey prompt or RPC call (#763)
 * - Idempotent revoke against already-revoked keys (#765)
 */
export function createHardenedAgentsFacade(
  deps: AgentsFacadeDeps,
  options: HardenedAgentsFacadeOptions = {},
): AgentsFacade {
  const idempotencyMode = options.idempotencyMode ?? "noop";
  const revokedKeys = new Map<string, { hash: string }>();

  function requireRuntime(): AgentKeyRuntime {
    if (!deps.runtime) throw new AgentsNotConfiguredError();
    return deps.runtime;
  }

  function validateMint(input: MintAgentInput): void {
    if (!ED25519_PUBLIC_KEY.test(input.publicKey)) {
      throw new InvalidAgentInputError("publicKey must be an ed25519 public key (G…)");
    }
    if (!input.grants || input.grants.length === 0) {
      throw new InvalidAgentInputError("at least one token grant is required");
    }

    for (const grant of input.grants) {
      if (!CONTRACT_ID.test(grant.token)) {
        throw new InvalidAgentInputError(`grant token must be a contract id (C…): ${grant.token}`);
      }
      assertNoDuplicatePolicies(grant);
    }
  }

  return {
    async mint(input: MintAgentInput): Promise<MintAgentResult> {
      const runtime = requireRuntime();
      const session = deps.requireSession();

      // Client-side validations happen BEFORE session resume or passkey prompt
      validateMint(input);
      const expirationSeconds = validateExpiresAt(input.expiresAt);

      if (session.keyId && runtime.resume) {
        await runtime.resume(session.keyId);
      }

      const { hash } = await runtime.addAgentKey({
        publicKey: input.publicKey,
        grants: input.grants,
        ...(expirationSeconds !== undefined ? { expirationSeconds } : {}),
        store: input.store ?? "persistent",
      });

      return {
        hash,
        publicKey: input.publicKey,
        ...(expirationSeconds !== undefined
          ? { expiresAt: new Date(expirationSeconds * 1000).toISOString() }
          : {}),
      };
    },

    /**
     * Remove the agent key from the wallet (passkey-signed). On-chain removal
     * is the remote kill switch: the key stops signing immediately.
     *
     * Idempotency Guarantee:
     * Calling revoke twice on the same publicKey will either succeed as a no-op
     * (returning the original confirmation hash) or throw `AgentKeyNotFoundError`.
     * It will NEVER throw an unhandled or misleading error that suggests the first
     * revoke failed on-chain.
     */
    async revoke(publicKey: string): Promise<{ hash: string }> {
      const runtime = requireRuntime();
      const session = deps.requireSession();

      if (!ED25519_PUBLIC_KEY.test(publicKey)) {
        throw new InvalidAgentInputError("publicKey must be an ed25519 public key (G…)");
      }

      // Check if key is already known to be revoked locally
      if (revokedKeys.has(publicKey)) {
        if (idempotencyMode === "throw-not-found") {
          throw new AgentKeyNotFoundError(publicKey);
        }
        return revokedKeys.get(publicKey)!;
      }

      if (session.keyId && runtime.resume) {
        await runtime.resume(session.keyId);
      }

      try {
        const result = await runtime.removeAgentKey(publicKey);
        revokedKeys.set(publicKey, result);
        return result;
      } catch (err) {
        // If the runtime error indicates the key was already revoked or not found
        if (
          err instanceof AgentKeyNotFoundError ||
          (err instanceof Error && /not found|already revoked|does not exist/i.test(err.message))
        ) {
          if (idempotencyMode === "throw-not-found") {
            throw new AgentKeyNotFoundError(publicKey);
          }
          return { hash: "already-revoked" };
        }
        throw err;
      }
    },
  };
}

/**
 * Caller retry helper that demonstrates how callers can safely retry
 * `revoke` over network timeouts.
 *
 * If a retry returns `AgentKeyNotFoundError` or succeeds as a no-op, the
 * helper recognizes that the key was revoked on-chain and resolves successfully.
 */
export async function revokeWithRetry(
  facade: AgentsFacade,
  publicKey: string,
  maxRetries: number = 2,
): Promise<{ hash: string; retried: boolean }> {
  let attempt = 0;
  while (true) {
    try {
      const result = await facade.revoke(publicKey);
      return { hash: result.hash, retried: attempt > 0 };
    } catch (err) {
      if (err instanceof AgentKeyNotFoundError) {
        // Confirmed revoked on previous attempt that timed out!
        return { hash: "already-revoked", retried: true };
      }
      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }
    }
  }
}
