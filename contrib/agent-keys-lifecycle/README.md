# Agent Session Keys Mint & Revoke Lifecycle (`#629`)

## Overview

`src/agents-facade.ts` (`wallet.agents` / `createAgentsFacade`) lets a Vellar smart-wallet owner mint and revoke policy-scoped Ed25519 session keys for autonomous agents ("give your agent a budget, not your keys").

This contrib example demonstrates the complete end-to-end lifecycle wired against a hermetic mock `AgentKeyRuntime` (`createMockAgentKeyRuntime`) so it runs locally and in CI without requiring a browser WebAuthn passkey prompt or a funded Stellar account:

1. **Key Generation**: Generates a throwaway Ed25519 keypair (`Keypair.random()`). Only the public key (`G...`) is passed to the SDK; the secret seed stays with the agent.
2. **Minting with Stacked Policies (`agents.mint`)**: Registers the agent's public key on the wallet with a token grant (`TESTNET.usdcContractId`) requiring **both** a spending-limit policy (`DEMO_SPENDING_LIMIT_POLICY_ID`) and a verified-recipient policy (`DEMO_VERIFIED_ONLY_POLICY_ID`) to co-sign inside `__check_auth`.
3. **Active Signing Verification (`authorizeTransfer`)**: Confirms that the newly minted key can authorize a USDC transfer when both policy contracts co-sign, and is rejected if either policy co-signer is missing or if a non-granted token is requested.
4. **On-Chain Revocation (`agents.revoke`)**: Removes the agent key from the smart wallet's signer set (`removeAgentKey`).
5. **Post-Revoke Rejection**: Confirms that any subsequent signing attempt by the revoked agent key is immediately rejected (`SIGNER_NOT_REGISTERED`).

## Running the Example

```bash
npx tsx contrib/agent-keys-lifecycle/index.ts
```

## Running the Tests

```bash
npx vitest run contrib/agent-keys-lifecycle/index.test.ts
```
