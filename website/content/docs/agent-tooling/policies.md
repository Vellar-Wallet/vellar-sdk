# Policies

> On-chain rules that govern what a smart account can do. A spending-limit policy caps how much an agent can spend per window; a verified-only policy restricts it to contracts with verifiable source. Both are enforced by Stellar consensus, not by your code.

By the end of this page you will have deployed a spending-limit policy, know what a fixed tumbling window means and why it implies a 2x edge case, understand the difference between verified and audited, and have smoke-tested the policy gateway with no wallet involved.

## Prerequisites

- **`vellar-sdk` installed** (see [Installation](../getting-started/installation.md)).
- **`apiUrl`** on `createVellarWallet`, pointing at your policy API gateway.
- **`policyAttach`** configured on `createVellarWallet`. It is required for `deploy()`, but not for `listTemplates()`, `generate()` or `simulate()`.

## Why on-chain policies

A Vellar smart account is a `C` address, which means it is a Soroban contract, which means it can carry programmable policies enforced inside `__check_auth` during authorization.

That placement is the whole point. No frontend change, no gateway rule and no compromised agent process can bypass a policy, because the chain refuses the transaction when the policy refuses the payment.

| Policy | Enforces | What it cannot do |
| --- | --- | --- |
| Spending-limit | How much an agent can move per fixed window | Control which recipient receives the payment |
| Verified-only | Which contracts may receive a payment | Cap the amount |

Neither is complete alone. Stack both on one agent key and you bound the amount *and* restrict the recipient code. See [Agent keys](./agent-keys.md) for how the policies get named in a key's grants.

## 1. Configure the policy gateway

Pass `apiUrl` (your policy API gateway) to `createVellarWallet`. To *deploy* a policy you also pass a `policyAttach` runtime that signs `addPolicy` with the passkey.

```ts
const vellar = createVellarWallet({
  network: "testnet",
  appName: "My App",
  kit,
  sac,
  backend,
  isValidAddress,
  // The hosted testnet policy gateway (same host as the wallet backend).
  // Production: your own gateway. Free instance, so the first request after a
  // quiet spell can take 30-90s (occasionally about 2 min) while it wakes.
  apiUrl: "https://vellar-backend.onrender.com",
  policyAttach: {
    // build kit.addPolicy(contractId), passkey-sign, submit via your backend
    async attachPolicy(policyContractId) {
      const tx = await kit.addPolicy(policyContractId);
      const signed = await kit.sign(tx);
      return backend.submitTransaction({ signedXdr: signed.toXDR(), network });
    },
    // optional: resume the passkey for a keyId without prompting
    async resume(keyId) {
      await kit.connectWallet({ keyId });
    },
  },
});
```

Without `apiUrl`, `wallet.policies` throws. Without `policyAttach`, the read, generate and simulate calls still work, but `deploy()` throws a clear error.

## 2. Smoke test the gateway

Nothing in this step needs a wallet or a passkey. Paste it anywhere (a browser console, a Node script) to confirm the gateway is live and see the real templates, including their honest enforcement labels.

```ts
import { createPolicyClient } from "vellar-sdk";

const policyClient = createPolicyClient({
  apiUrl: "https://vellar-backend.onrender.com",
  network: "testnet",
});

const templates = await policyClient.listTemplates();
console.log(templates.map((t) => `${t.type} - ${t.title} (${t.enforcement.kind})`));
// e.g. "spending_limit - Spending limit (policy-contract)"
```

If that prints templates, your config is correct. Everything after this is the same client with a wallet session attached, reached as `wallet.policies`.

> **Note:** The first call after a quiet spell is the cold start, not a failure. Give it a 120s timeout before deciding something is wrong.

## 3. Deploy a spending-limit policy

```ts
// 1. list the templates your gateway offers (with honest enforcement labels)
const templates = await vellar.policies.listTemplates();

// 2. generate the deployable artifacts for a definition (validates first)
const policy = await vellar.policies.generate({
  version: "1",
  type: "spending_limit",
  owners: [vellar.session!.accountId],
  spendingLimits: { dailyXlm: "100" }, // 100 XLM per 24h fixed window
});

// 3. (optional) dry-run the on-chain deploy, surfaces cost and errors, no submit
const sim = await vellar.policies.simulate(policy.id);

// 4. attach it to the wallet, the ONLY passkey prompt in this flow
const { contractId, attachTxHash } = await vellar.policies.deploy(policy.id);
```

What `deploy()` actually does, in order:

1. **Deploy instance.** Your backend deploys a per-user policy contract instance, bound to the wallet, sponsor-funded server-side.
2. **Attach.** The user passkey-signs `addPolicy` to attach the instance. This is the only WebAuthn prompt, with no silent signing.
3. **Record.** The completed attach is recorded via your gateway.

## 4. Understand the fixed tumbling window

The spending-limit policy is a dedicated policy contract enforcing a cumulative allowance over a **fixed (tumbling) window**. Spent resets to zero when the window elapses; it does not slide continuously.

> ⚠️ **Spending timed around a window boundary can move up to 2x the cap in a short span.** With a 100 XLM per 24h window, an agent could move 100 XLM just before the reset and another 100 just after. Treat the limit as an on-chain spending guardrail, not a to-the-stroop hard cap. For a hard guarantee, the contract itself recommends pairing it with a cryptographic co-signer.

## The verified-only policy

Instead of capping an amount, the verified-only policy reads an on-chain **AttestationRegistry** inside `__check_auth` and rejects any payment whose recipient contract is not attested as verified.

The AttestationRegistry is a Soroban contract, live on testnet. It is the on-chain source of truth for which contracts have reproducibly-verified source. An attestor mirrors verification outcomes into it, with ledger-based expiry so it fails closed.

The behaviour is easy to test. Attest a contract and an agent's payment to it settles. Revoke the attestation and the identical payment is rejected on-chain, with nothing changed but the verification status.

It is attached exactly like a spending limit, through `wallet.policies`. Stack both and an agent key can pay up to a budget and only through verified code.

> ⚠️ **Verified is not audited.** It proves provenance (reproducible, attributable source), not that the code is safe. A verified contract can still be a hostile one.

## The API

| Method | Description |
| --- | --- |
| `policies.listTemplates()` | Available policy templates plus their on-chain enforcement |
| `policies.generate(def)` | Validate a definition and produce the deployable artifacts |
| `policies.simulate(id)` | Dry-run the deploy for the connected wallet (no submit) |
| `policies.deploy(id)` | Instance deploy, passkey-sign `addPolicy`, record `{ contractId, attachTxHash }` |

## Your gateway

`wallet.policies` talks to these routes on your `apiUrl` gateway:

```
GET  /policies/templates
POST /policies/validate
POST /policies/generate
POST /policies/:id/simulate
POST /policies/:id/deploy-instance
POST /policies/deploy
```

> **Note:** Instance deploys are funded by **your** sponsor account, server-side. A policy is inert until the passkey-signed attach lands.

## Honesty

Each template declares how it is **actually** enforced on-chain, as `enforcementLabel`. A spending limit is a policy contract; multisig and allowlists use the smart wallet's native signer limits instead. The SDK never claims enforcement a template does not provide.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wallet.policies` throws immediately | `apiUrl` was not configured on `createVellarWallet` | Pass `apiUrl` pointing at your policy gateway |
| `deploy()` throws a clear error while `listTemplates`, `generate` and `simulate` work | `policyAttach` was not configured | Add the `policyAttach` runtime that builds `kit.addPolicy`, passkey-signs and submits |
| Policy deployed, but the agent is not limited | The policy is not named in the agent key's grants, so it never co-signs | Mint the agent key with that policy contract in the grant for the token (see [Agent keys](./agent-keys.md)) |
| More than the cap moved in a short span | Expected: the window tumbles rather than slides, so up to 2x the cap can move around a boundary | Size the window for that worst case, or pair the limit with a cryptographic co-signer |
| The first gateway request takes 30-90s | Free-tier cold start on the hosted testnet gateway (occasionally about 2 min) | Warm it with an early call and use a 120s timeout |

## Next steps

- [Agent keys](./agent-keys.md)
- [MCP payer](./mcp-payer.md)
- [Spend controls](../buyers/spend-controls.md)
- [Security](../security.md)
