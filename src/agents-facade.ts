// The agent-keys surface on the wallet handle (vellar.agents): mint and revoke
// scoped ed25519 session keys — "give your agent a budget, not your keys" as an
// SDK call instead of a hand-run script.
//
// A minted agent key is a REAL on-chain signer whose SignerLimits restrict it
// to specific token contracts, each requiring one or more POLICY contracts to
// co-sign inside the wallet's __check_auth:
//
//   grants: [{ token, policies: [spendingLimitId, verifiedOnlyId] }]
//     → limits { token → [Policy(spendingLimit), Policy(verifiedOnly)] }
//
// The chain enforces the result: the agent can only move the granted tokens,
// only within the attached budget, and (with the verified-only policy) only
// through contracts whose source is attested as verified. A compromised agent
// holding the session key cannot exceed any of it.
//
// Minting/revoking are ADMIN actions on the wallet — the passkey signs them
// (one prompt, no silent signing). Like `wallet.policies.deploy`, the passkey
// mechanics live behind a narrow host-wired runtime seam so this SDK stays
// free of a passkey-kit dependency and the seam is trivially mockable.

export interface AgentPolicyGrant {
  /** SEP-41 token contract (C…) the agent may transact through. */
  token: string;
  /** Policy contract ids (C…) that must ALL co-sign the agent's use of this
   * token (e.g. a spending-limit instance + a verified-only instance). An
   * empty array would grant unrestricted use of the token — deliberately
   * rejected; mint an unrestricted signer through your own kit wiring if you
   * truly mean that. */
  policies: string[];
}

export interface MintAgentInput {
  /** The agent's ed25519 public key (G…). Generate the keypair yourself
   * (e.g. `Keypair.random()`) — the SDK never sees or stores the secret. */
  publicKey: string;
  /** Token grants; at least one. */
  grants: AgentPolicyGrant[];
  /** Optional on-chain expiration. A Date, or unix SECONDS (the contract's
   * unit). Expired keys stop signing without a revoke. */
  expiresAt?: Date | number;
  /** Signer durability (default "persistent"). "temporary" entries are
   * cheaper but the wallet may shed them at the storage TTL. */
  store?: "persistent" | "temporary";
}

export interface MintAgentResult {
  hash: string;
  publicKey: string;
  expiresAt?: string;
}

/** The passkey-signed wallet-admin capability minting needs. Wire it to your
 * PasskeyKit: build kit.addEd25519 / kit.remove, kit.sign (the ONLY passkey
 * prompt), submit through your backend. See the docs for the ~15-line
 * reference wiring. */
export interface AgentKeyRuntime {
  /** Resume the connected passkey for a keyId without prompting, when possible. */
  resume?(keyId: string): Promise<void>;
  addAgentKey(input: {
    publicKey: string;
    grants: AgentPolicyGrant[];
    /** Unix seconds, already converted. */
    expirationSeconds?: number;
    store: "persistent" | "temporary";
  }): Promise<{ hash: string }>;
  removeAgentKey(publicKey: string): Promise<{ hash: string }>;
}

export interface AgentsFacade {
  /** Add the agent key as a policy-limited signer (passkey-signed). */
  mint(input: MintAgentInput): Promise<MintAgentResult>;
  /** Remove the agent key from the wallet (passkey-signed). On-chain removal
   * is the remote kill: the key stops signing immediately. */
  revoke(publicKey: string): Promise<{ hash: string }>;
}

export interface AgentsFacadeDeps {
  /** Returns the connected wallet's session, or throws if not ready. */
  requireSession(): { accountId: string; keyId?: string };
  runtime?: AgentKeyRuntime;
}

export class AgentsNotConfiguredError extends Error {
  constructor() {
    super(
      "wallet.agents requires `agentKeys` in createVellarWallet config (the passkey-signed wallet-admin runtime).",
    );
    this.name = "AgentsNotConfiguredError";
  }
}

export class InvalidAgentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAgentInputError";
  }
}

const ED25519_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

function toExpirationSeconds(expiresAt: Date | number | undefined): number | undefined {
  if (expiresAt === undefined) return undefined;
  const seconds =
    expiresAt instanceof Date ? Math.floor(expiresAt.getTime() / 1000) : Math.floor(expiresAt);
  if (!Number.isFinite(seconds) || seconds <= Math.floor(Date.now() / 1000)) {
    throw new InvalidAgentInputError("expiresAt must be in the future");
  }
  return seconds;
}

export function createAgentsFacade(deps: AgentsFacadeDeps): AgentsFacade {
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
      if (!grant.policies || grant.policies.length === 0) {
        throw new InvalidAgentInputError(
          `grant for ${grant.token} has no policies — an unrestricted grant is not mintable through wallet.agents`,
        );
      }
      for (const policy of grant.policies) {
        if (!CONTRACT_ID.test(policy)) {
          throw new InvalidAgentInputError(`policy must be a contract id (C…): ${policy}`);
        }
      }
    }
  }

  return {
    async mint(input) {
      const runtime = requireRuntime();
      const session = deps.requireSession();
      validateMint(input);
      const expirationSeconds = toExpirationSeconds(input.expiresAt);

      if (session.keyId && runtime.resume) await runtime.resume(session.keyId);

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

    async revoke(publicKey) {
      const runtime = requireRuntime();
      const session = deps.requireSession();
      if (!ED25519_PUBLIC_KEY.test(publicKey)) {
        throw new InvalidAgentInputError("publicKey must be an ed25519 public key (G…)");
      }
      if (session.keyId && runtime.resume) await runtime.resume(session.keyId);
      return runtime.removeAgentKey(publicKey);
    },
  };
}
