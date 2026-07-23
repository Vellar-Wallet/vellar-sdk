# Policies

Vellar smart accounts are Soroban contracts, so they can carry **programmable
on-chain policies** — spending limits, multisig, allowlists — enforced by the
account itself, not by your UI. The SDK exposes the full flow on the wallet
handle as `wallet.policies`.

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
  apiUrl: "https://api.myapp.com", // your policy API gateway
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

## The flow

```ts
// 1. list the templates your gateway offers (with honest enforcement labels)
const templates = await vellar.policies.listTemplates();

// 2. generate the deployable artifacts for a definition (validates first)
const policy = await vellar.policies.generate({
  version: "1",
  type: "spending_limit",
  owners: [vellar.session!.accountId],
  spendingLimits: { dailyXlm: "100" }, // 100 XLM per rolling window
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
rolling-window allowance; multisig/allowlists use the smart wallet's native
signer limits. The SDK never claims enforcement a template doesn't provide, and
a policy is inert until the passkey-signed attach lands.

## Next steps

- [Wallet Methods](./wallet-methods.md) — every method on the wallet handle
- [Security](./security.md) — the guarantees the SDK enforces
