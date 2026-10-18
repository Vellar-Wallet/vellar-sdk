// Standalone contrib example (#629): Demonstrates the Vellar `wallet.agents`
// (`createAgentsFacade`) mint and revoke flow end-to-end with a spending-limit
// and verified-only policy grant, wired against a mock `AgentKeyRuntime` that
// simulates on-chain smart-wallet `__check_auth` signer enforcement without
// requiring a live passkey ceremony or funded Stellar account.

import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createAgentsFacade,
  type AgentKeyRuntime,
  type AgentPolicyGrant,
  type MintAgentResult,
} from "../../src/agents-facade";
import { WalletNotReadyError } from "../../src/client";
import { TESTNET } from "../../src/config";

export const DEMO_SMART_WALLET_ADDRESS =
  "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";
export const DEMO_SPENDING_LIMIT_POLICY_ID =
  "CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3";
export const DEMO_VERIFIED_ONLY_POLICY_ID =
  "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

export const DEMO_MINT_TX_HASH =
  "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b";
export const DEMO_REVOKE_TX_HASH =
  "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e";

export interface StoredAgentSignerRecord {
  readonly publicKey: string;
  readonly grants: AgentPolicyGrant[];
  readonly expirationSeconds?: number;
  readonly store: "persistent" | "temporary";
}

export class AgentAuthRejectedError extends Error {
  readonly code: "SIGNER_NOT_REGISTERED" | "SIGNER_EXPIRED" | "TOKEN_NOT_GRANTED" | "MISSING_POLICY_COSIGNER" | "INVALID_SIGNATURE";

  constructor(
    code: "SIGNER_NOT_REGISTERED" | "SIGNER_EXPIRED" | "TOKEN_NOT_GRANTED" | "MISSING_POLICY_COSIGNER" | "INVALID_SIGNATURE",
    message: string,
  ) {
    super(message);
    this.name = "AgentAuthRejectedError";
    this.code = code;
  }
}

export interface MockAgentKeyRuntime extends AgentKeyRuntime {
  /** Snapshot of currently active on-chain agent signers registered on the wallet. */
  readonly activeSigners: ReadonlyMap<string, StoredAgentSignerRecord>;
  /** Recorded passkey resume / addAgentKey / removeAgentKey operations. */
  readonly operations: Array<
    | { kind: "resume"; keyId: string }
    | {
        kind: "addAgentKey";
        publicKey: string;
        grants: AgentPolicyGrant[];
        expirationSeconds?: number;
        store: "persistent" | "temporary";
      }
    | { kind: "removeAgentKey"; publicKey: string }
  >;
  /**
   * Simulate the smart wallet's `__check_auth` verification for a token transfer
   * signed by `agentKeypair`. Succeeds only while the agent's public key is
   * registered, unexpired, granted for `token`, and accompanied by all required
   * policy co-signers. Immediately rejects after `revoke(publicKey)`.
   */
  authorizeTransfer(input: {
    agentKeypair: Keypair;
    token: string;
    recipient: string;
    amountBaseUnits: bigint;
    coSignedPolicies: string[];
    nowSeconds?: number;
  }): { authorized: true; signatureHex: string; enforcedPolicies: string[] };
}

/**
 * Create a hermetic mock `AgentKeyRuntime` that models the smart wallet's
 * on-chain Ed25519 signer table and `SignerLimits` policy enforcement.
 */
export function createMockAgentKeyRuntime(): MockAgentKeyRuntime {
  const signers = new Map<string, StoredAgentSignerRecord>();
  const operations: MockAgentKeyRuntime["operations"] = [];

  return {
    activeSigners: signers,
    operations,

    async resume(keyId: string) {
      operations.push({ kind: "resume", keyId });
    },

    async addAgentKey({ publicKey, grants, expirationSeconds, store }) {
      operations.push({
        kind: "addAgentKey",
        publicKey,
        grants,
        ...(expirationSeconds !== undefined ? { expirationSeconds } : {}),
        store,
      });
      signers.set(publicKey, {
        publicKey,
        grants: grants.map((g) => ({ token: g.token, policies: [...g.policies] })),
        ...(expirationSeconds !== undefined ? { expirationSeconds } : {}),
        store,
      });
      return { hash: DEMO_MINT_TX_HASH };
    },

    async removeAgentKey(publicKey: string) {
      operations.push({ kind: "removeAgentKey", publicKey });
      signers.delete(publicKey);
      return { hash: DEMO_REVOKE_TX_HASH };
    },

    authorizeTransfer({
      agentKeypair,
      token,
      recipient,
      amountBaseUnits,
      coSignedPolicies,
      nowSeconds = Math.floor(Date.now() / 1000),
    }) {
      const publicKey = agentKeypair.publicKey();
      const record = signers.get(publicKey);
      if (!record) {
        throw new AgentAuthRejectedError(
          "SIGNER_NOT_REGISTERED",
          `Error(Contract, #110): agent key ${publicKey} is not an active signer on wallet ${DEMO_SMART_WALLET_ADDRESS} (revoked or never minted).`,
        );
      }

      if (record.expirationSeconds !== undefined && nowSeconds >= record.expirationSeconds) {
        throw new AgentAuthRejectedError(
          "SIGNER_EXPIRED",
          `Error(Contract, #110): agent key ${publicKey} expired at unix ${record.expirationSeconds} (now=${nowSeconds}).`,
        );
      }

      const grant = record.grants.find((g) => g.token === token);
      if (!grant) {
        throw new AgentAuthRejectedError(
          "TOKEN_NOT_GRANTED",
          `Error(Contract, #110): agent key ${publicKey} has no SignerLimits grant for token ${token}.`,
        );
      }

      for (const requiredPolicy of grant.policies) {
        if (!coSignedPolicies.includes(requiredPolicy)) {
          throw new AgentAuthRejectedError(
            "MISSING_POLICY_COSIGNER",
            `Error(Contract, #110): missing required policy co-signer ${requiredPolicy} for token ${token}.`,
          );
        }
      }

      const payload = Buffer.from(
        JSON.stringify({
          wallet: DEMO_SMART_WALLET_ADDRESS,
          token,
          recipient,
          amount: amountBaseUnits.toString(),
          policies: [...grant.policies].sort(),
        }),
        "utf8",
      );
      const signature = agentKeypair.sign(payload);
      if (!agentKeypair.verify(payload, signature)) {
        throw new AgentAuthRejectedError(
          "INVALID_SIGNATURE",
          "Ed25519 signature verification failed.",
        );
      }

      return {
        authorized: true,
        signatureHex: Buffer.from(signature).toString("hex"),
        enforcedPolicies: [...grant.policies],
      };
    },
  };
}

export interface RunAgentKeysLifecycleOptions {
  /** Custom runtime (pass `null` to simulate unconfigured `agentKeys` runtime). */
  runtime?: MockAgentKeyRuntime | null;
  /** Whether to simulate calling `wallet.agents` before connecting a wallet session. */
  skipSession?: boolean;
  /** Custom logger (defaults to `console.log`). */
  log?: (line: string) => void;
}

export interface AgentKeysLifecycleResult {
  readonly agentPublicKey: string;
  readonly mintResult: MintAgentResult;
  readonly authorizedBeforeRevoke: {
    authorized: true;
    signatureHex: string;
    enforcedPolicies: string[];
  };
  readonly revokeResult: { hash: string };
  readonly rejectedAfterRevokeError: AgentAuthRejectedError;
  readonly runtimeOperations: MockAgentKeyRuntime["operations"];
  readonly logs: string[];
}

/**
 * End-to-end walkthrough of the Vellar agent-keys lifecycle:
 * 1. Generate a throwaway Ed25519 agent keypair (`Keypair.random()`).
 * 2. Mint the agent key via `agents.mint(...)` with a `spending-limit` +
 *    `verified-only` policy grant on Circle USDC (`TESTNET.usdcContractId`).
 * 3. Verify the minted key can sign a policy-governed transfer while active.
 * 4. Revoke the agent key via `agents.revoke(agentKey.publicKey())`.
 * 5. Confirm the key stops signing immediately after revocation.
 */
export async function runAgentKeysLifecycleExample(
  options: RunAgentKeysLifecycleOptions = {},
): Promise<AgentKeysLifecycleResult> {
  const logs: string[] = [];
  const emit = (line: string) => {
    logs.push(line);
    (options.log ?? console.log)(line);
  };

  const mockRuntime =
    options.runtime === null ? undefined : (options.runtime ?? createMockAgentKeyRuntime());

  const agents = createAgentsFacade({
    requireSession: () => {
      if (options.skipSession) {
        throw new WalletNotReadyError("Call create() or connect() before using agents");
      }
      return {
        accountId: DEMO_SMART_WALLET_ADDRESS,
        keyId: "passkey-admin-cred-01",
      };
    },
    runtime: mockRuntime,
  });

  // 1. Generate a throwaway non-production Ed25519 keypair for the agent.
  const agentKey = Keypair.random();
  const agentPublicKey = agentKey.publicKey();
  emit(`[Step 1: Keygen] Generated throwaway agent public key: ${agentPublicKey}`);

  // 2. Mint the agent key with BOTH a spending-limit and a verified-only policy grant.
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const mintResult = await agents.mint({
    publicKey: agentPublicKey,
    grants: [
      {
        token: TESTNET.usdcContractId,
        policies: [DEMO_SPENDING_LIMIT_POLICY_ID, DEMO_VERIFIED_ONLY_POLICY_ID],
      },
    ],
    expiresAt,
    store: "persistent",
  });
  emit(
    `[Step 2: mint] Minted agent signer ${mintResult.publicKey} txHash=${mintResult.hash} expiresAt=${mintResult.expiresAt ?? "none"}`,
  );

  // 3. Verify that the active agent key signs and passes wallet __check_auth with both policies.
  const authorizedBeforeRevoke = mockRuntime!.authorizeTransfer({
    agentKeypair: agentKey,
    token: TESTNET.usdcContractId,
    recipient: TESTNET.usdcIssuer,
    amountBaseUnits: 1_000_000n,
    coSignedPolicies: [DEMO_SPENDING_LIMIT_POLICY_ID, DEMO_VERIFIED_ONLY_POLICY_ID],
  });
  emit(
    `[Step 3: Sign Active] Authorized transfer with ${authorizedBeforeRevoke.enforcedPolicies.length} co-signing policies (sig=${authorizedBeforeRevoke.signatureHex.slice(0, 16)}...)`,
  );

  // 4. Revoke the agent key on-chain ("remote kill").
  const revokeResult = await agents.revoke(agentPublicKey);
  emit(`[Step 4: revoke] Revoked agent signer ${agentPublicKey} txHash=${revokeResult.hash}`);

  // 5. Confirm that the revoked agent key stops signing immediately afterward.
  let rejectedAfterRevokeError: AgentAuthRejectedError | undefined;
  try {
    mockRuntime!.authorizeTransfer({
      agentKeypair: agentKey,
      token: TESTNET.usdcContractId,
      recipient: TESTNET.usdcIssuer,
      amountBaseUnits: 1_000_000n,
      coSignedPolicies: [DEMO_SPENDING_LIMIT_POLICY_ID, DEMO_VERIFIED_ONLY_POLICY_ID],
    });
  } catch (err) {
    if (err instanceof AgentAuthRejectedError) {
      rejectedAfterRevokeError = err;
    } else {
      throw err;
    }
  }

  if (!rejectedAfterRevokeError) {
    throw new Error("Expected revoked agent key to be rejected when attempting to sign.");
  }
  emit(
    `[Step 5: Verify Revoked] Post-revoke signing attempt rejected as expected: ${rejectedAfterRevokeError.code}`,
  );

  return {
    agentPublicKey,
    mintResult,
    authorizedBeforeRevoke,
    revokeResult,
    rejectedAfterRevokeError,
    runtimeOperations: mockRuntime ? [...mockRuntime.operations] : [],
    logs,
  };
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  runAgentKeysLifecycleExample().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
