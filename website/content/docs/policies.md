# Policies & Provenance

Vellar smart accounts are Soroban contracts, so they can carry **programmable
on-chain policies** — spending limits, multisig, allowlists, and **provenance**
— enforced by the account itself, not by your UI. The SDK exposes the full flow
on the wallet handle as `wallet.policies`.

Two policies matter most for agent payments, and they stack:

- **Spending-limit** — a cumulative cap on *how much* an agent can move per
  fixed window. Even a fully compromised key stays inside its bound — at most
  the cap per window, and never more than 2× the cap in a short span around a
  window reset (see [Honesty](#honesty)).
- **Verified-only (provenance)** — restricts an agent to paying *only* contracts
  whose source has been reproducibly verified against the deployed wasm. An
  unverified recipient is rejected on-chain.

Both are checked inside the wallet's `__check_auth` during authorization, so
they're enforced by **Stellar consensus**, not by your code — see [x402
payments](./x402.md) and [agent keys](./agent-keys.md) for how an agent pays
under them.

## Enabling policies

Pass `apiUrl` (your policy API gateway) to `createVellarWallet`. To _deploy_ a
policy you also pass a `policyAttach` runtime that signs `addPolicy` with the
passkey:

```ts
const vellar = createVellarWallet({
  network: "testnet",
  appName: "My App",
  kit,
  sac,
  backend,
  isValidAddress,
  // The hosted testnet policy gateway (same host as the wallet backend).
  // Production: your own gateway. Free instance — the first request after a
  // quiet spell can take 30-60s while it wakes.
  apiUrl: "https://vellar-backend.onrender.com",
  policyAttach: {
    // build kit.addPolicy(contractId) → passkey-sign → submit via your backend
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

Without `apiUrl`, `wallet.policies` throws. Without `policyAttach`, read /
generate / simulate still work but `deploy()` throws a clear error.

### Zero-context smoke test

Nothing here needs a wallet or a passkey — paste this anywhere (browser console,
a Node script) to confirm the gateway is live and see the real templates,
including their honest enforcement labels:

```ts
import { createPolicyClient } from "vellar-sdk";

const policyClient = createPolicyClient({
  apiUrl: "https://vellar-backend.onrender.com",
  network: "testnet",
});

const templates = await policyClient.listTemplates();
console.log(templates.map((t) => `${t.type} — ${t.title} (${t.enforcement.kind})`));
// e.g. "spending_limit — Spending limit (policy-contract)"
```

If that prints templates, your config is right — everything after this is the
same client with a wallet session attached (`wallet.policies`).

## The flow

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

// 3. (optional) dry-run the on-chain deploy — surfaces cost/errors, no submit
const sim = await vellar.policies.simulate(policy.id);

// 4. attach it to the wallet — the ONLY passkey prompt in this flow
const { contractId, attachTxHash } = await vellar.policies.deploy(policy.id);
```

### What `deploy()` actually does

1. **Deploy instance** — your backend deploys a per-user policy contract
   instance, bound to the wallet, **sponsor-funded server-side**.
2. **Attach** — the user passkey-signs `addPolicy` to attach the instance. This
   is the **only** WebAuthn prompt — no silent signing.
3. **Record** — the completed attach is recorded via your gateway.

## Provenance (verified-only)

The verified-only policy is the **provenance layer**. Instead of capping an
amount, it reads an on-chain **attestation registry** inside `__check_auth` and
rejects any payment whose recipient contract isn't attested as verified.

- The **AttestationRegistry** (a Soroban contract, live on testnet) is the
  on-chain source of truth for which contracts have reproducibly-verified
  source. An attestor mirrors verification outcomes into it, with ledger-based
  expiry so it fails closed.
- The **verified-only policy** reads that registry during authorization. Attest
  a contract → an agent's payment to it settles. Revoke the attestation → the
  identical payment is rejected on-chain and no funds move. Nothing changes but
  the verification status.

Attach it exactly like a spending limit (through `wallet.policies`), and stack
both so an agent key can pay *up to a budget* and *only through verified code*.
This is `verified ≠ audited` — it proves *provenance* (reproducible, attributable
source), not safety. See [agent keys](./agent-keys.md) for the full mint flow.

## API

| Method                    | Description                                                        |
| ------------------------- | ----------------------------------------------------------------- |
| `policies.listTemplates()`| Available policy templates + their on-chain enforcement           |
| `policies.generate(def)`  | Validate a definition and produce the deployable artifacts        |
| `policies.simulate(id)`   | Dry-run the deploy for the connected wallet (no submit)           |
| `policies.deploy(id)`     | Instance deploy → passkey-sign `addPolicy` → record `{ contractId, attachTxHash }` |

## Your gateway

`wallet.policies` talks to these routes on your `apiUrl` gateway (instance
deploys are funded by **your** sponsor account, server-side):

```
GET  /policies/templates
POST /policies/validate
POST /policies/generate
POST /policies/:id/simulate
POST /policies/:id/deploy-instance
POST /policies/deploy
```

## Honesty

Each template declares how it is **actually** enforced on-chain (`enforcementLabel`)
— e.g. a spending limit is a dedicated policy contract enforcing a cumulative
allowance over a **fixed (tumbling) window**: spent resets to zero when the
window elapses; it does not slide continuously. Spending timed around a window
boundary can therefore move up to **2× the cap** in a short span — treat the
limit as an on-chain spending guardrail, not a to-the-stroop hard cap. (For a
hard guarantee, the contract itself recommends pairing it with a cryptographic
co-signer.) Multisig/allowlists use the smart wallet's native signer limits.
The SDK never claims enforcement a template doesn't provide, and a policy is
inert until the passkey-signed attach lands.

## Next steps

- [Wallet Methods](./wallet-methods.md) — every method on the wallet handle
- [Security](./security.md) — the guarantees the SDK enforces
