// Unit and end-to-end tests for the agent-keys mint and revoke flow example (#629).

import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  AgentsNotConfiguredError,
  InvalidAgentInputError,
  createAgentsFacade,
} from "../../src/agents-facade";
import { WalletNotReadyError } from "../../src/client";
import { TESTNET } from "../../src/config";
import {
  AgentAuthRejectedError,
  DEMO_MINT_TX_HASH,
  DEMO_REVOKE_TX_HASH,
  DEMO_SMART_WALLET_ADDRESS,
  DEMO_SPENDING_LIMIT_POLICY_ID,
  DEMO_VERIFIED_ONLY_POLICY_ID,
  createMockAgentKeyRuntime,
  runAgentKeysLifecycleExample,
} from "./index";

describe("contrib/agent-keys-lifecycle — mint and revoke flow end to end (#629)", () => {
  it("runs the example end-to-end: mints with spending-limit + verified-only policies, signs, revokes, and confirms signing stops afterward", async () => {
    const runtime = createMockAgentKeyRuntime();
    const result = await runAgentKeysLifecycleExample({
      runtime,
      log: () => {},
    });

    expect(result.mintResult.hash).toBe(DEMO_MINT_TX_HASH);
    expect(result.mintResult.publicKey).toBe(result.agentPublicKey);
    expect(result.mintResult.expiresAt).toBeDefined();

    // Before revoke, the key is authorized with both policies enforced.
    expect(result.authorizedBeforeRevoke.authorized).toBe(true);
    expect(result.authorizedBeforeRevoke.enforcedPolicies).toEqual([
      DEMO_SPENDING_LIMIT_POLICY_ID,
      DEMO_VERIFIED_ONLY_POLICY_ID,
    ]);

    // Revoke succeeds and removes the key from the wallet's active signer table.
    expect(result.revokeResult.hash).toBe(DEMO_REVOKE_TX_HASH);
    expect(runtime.activeSigners.size).toBe(0);

    // After revoke, any attempt to sign with the key is immediately rejected.
    expect(result.rejectedAfterRevokeError).toBeInstanceOf(AgentAuthRejectedError);
    expect(result.rejectedAfterRevokeError.code).toBe("SIGNER_NOT_REGISTERED");

    // Verify passkey session resume occurred before both admin operations.
    expect(result.runtimeOperations.map((op) => op.kind)).toEqual([
      "resume",
      "addAgentKey",
      "resume",
      "removeAgentKey",
    ]);
  });

  it("throws AgentsNotConfiguredError when no AgentKeyRuntime is wired", async () => {
    await expect(
      runAgentKeysLifecycleExample({
        runtime: null,
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(AgentsNotConfiguredError);
  });

  it("throws WalletNotReadyError when mint or revoke is called without an active session", async () => {
    await expect(
      runAgentKeysLifecycleExample({
        skipSession: true,
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(WalletNotReadyError);
  });

  it("rejects unrestricted grants (empty policies array), empty grants, malformed addresses, and past expirations", async () => {
    const runtime = createMockAgentKeyRuntime();
    const agents = createAgentsFacade({
      requireSession: () => ({ accountId: DEMO_SMART_WALLET_ADDRESS }),
      runtime,
    });
    const kp = Keypair.random();

    // Unrestricted grant (empty policies list) is forbidden by wallet.agents.mint.
    await expect(
      agents.mint({
        publicKey: kp.publicKey(),
        grants: [{ token: TESTNET.usdcContractId, policies: [] }],
      }),
    ).rejects.toBeInstanceOf(InvalidAgentInputError);

    // Empty grants array is rejected.
    await expect(
      agents.mint({
        publicKey: kp.publicKey(),
        grants: [],
      }),
    ).rejects.toBeInstanceOf(InvalidAgentInputError);

    // Malformed public key is rejected on both mint and revoke.
    await expect(
      agents.mint({
        publicKey: "not-an-ed25519-key",
        grants: [{ token: TESTNET.usdcContractId, policies: [DEMO_SPENDING_LIMIT_POLICY_ID] }],
      }),
    ).rejects.toBeInstanceOf(InvalidAgentInputError);

    await expect(agents.revoke("not-an-ed25519-key")).rejects.toBeInstanceOf(
      InvalidAgentInputError,
    );

    // Past expiration timestamp is rejected.
    await expect(
      agents.mint({
        publicKey: kp.publicKey(),
        grants: [{ token: TESTNET.usdcContractId, policies: [DEMO_SPENDING_LIMIT_POLICY_ID] }],
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ).rejects.toBeInstanceOf(InvalidAgentInputError);

    // None of the invalid inputs reached the underlying passkey runtime.
    expect(runtime.operations).toHaveLength(0);
  });

  it("rejects transfers missing a required policy co-signer or using an expired agent key", async () => {
    const runtime = createMockAgentKeyRuntime();
    const agents = createAgentsFacade({
      requireSession: () => ({ accountId: DEMO_SMART_WALLET_ADDRESS }),
      runtime,
    });
    const agentKey = Keypair.random();
    const futureSeconds = Math.floor(Date.now() / 1000) + 3600;

    await agents.mint({
      publicKey: agentKey.publicKey(),
      grants: [
        {
          token: TESTNET.usdcContractId,
          policies: [DEMO_SPENDING_LIMIT_POLICY_ID, DEMO_VERIFIED_ONLY_POLICY_ID],
        },
      ],
      expiresAt: futureSeconds,
    });

    // Missing DEMO_VERIFIED_ONLY_POLICY_ID co-signer -> rejected.
    expect(() =>
      runtime.authorizeTransfer({
        agentKeypair: agentKey,
        token: TESTNET.usdcContractId,
        recipient: TESTNET.usdcIssuer,
        amountBaseUnits: 500_000n,
        coSignedPolicies: [DEMO_SPENDING_LIMIT_POLICY_ID],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "AgentAuthRejectedError",
        code: "MISSING_POLICY_COSIGNER",
      }),
    );

    // Unlisted token contract -> rejected.
    expect(() =>
      runtime.authorizeTransfer({
        agentKeypair: agentKey,
        token: TESTNET.nativeTokenContractId,
        recipient: TESTNET.usdcIssuer,
        amountBaseUnits: 500_000n,
        coSignedPolicies: [DEMO_SPENDING_LIMIT_POLICY_ID, DEMO_VERIFIED_ONLY_POLICY_ID],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "AgentAuthRejectedError",
        code: "TOKEN_NOT_GRANTED",
      }),
    );

    // Expired key -> rejected without needing explicit revoke().
    expect(() =>
      runtime.authorizeTransfer({
        agentKeypair: agentKey,
        token: TESTNET.usdcContractId,
        recipient: TESTNET.usdcIssuer,
        amountBaseUnits: 500_000n,
        coSignedPolicies: [DEMO_SPENDING_LIMIT_POLICY_ID, DEMO_VERIFIED_ONLY_POLICY_ID],
        nowSeconds: futureSeconds + 1,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "AgentAuthRejectedError",
        code: "SIGNER_EXPIRED",
      }),
    );
  });
});
