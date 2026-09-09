# Agent Keys

> Give your agent a budget, not your keys. An agent key is a real on-chain signer on the user's smart wallet, scoped to specific tokens, valid until a date you set, revocable in one transaction.

By the end of this page you will have minted an agent key with a spending-limit policy attached, understand why on-chain enforcement is different from a software budget, and know how to revoke a compromised key immediately.

An agent key is restricted so it can only move specific tokens, and only when the policy contracts you attach co-sign inside the wallet's `__check_auth`. The chain enforces the result: an autonomous agent holding the key can pay for things on its own, but cannot spend past its per-window cap or step outside its policies, even if the key is fully compromised.

The SDK exposes this as `wallet.agents`.

## Why on-chain enforcement is different

Most agent-payment tools enforce spending limits in code the agent runs, or in a gateway it calls. A rule that lives in code is a rule the agent can bypass if it is compromised. A Vellar agent key's limits live in the smart wallet's `__check_auth`, so they are checked by Stellar consensus every time the agent signs.

| Enforcement | Where | Bypassable if the agent is compromised? |
| --- | --- | --- |
| Software budget | The agent process | Yes |
| Gateway limit | An external service | Yes, if the agent exfiltrates the key |
| Vellar spending-limit policy | On-chain, in `__check_auth` | No, the chain enforces it regardless |

Two policies stack, and both are enforced on-chain:

- a **spending-limit** policy: *how much*, a cumulative cap over a fixed window,
- a **verified-only** policy: *through what*, only contracts whose source is reproducibly verified (see [Policies](./policies.md)).

A key restricted by both can pay for API calls all day, but cannot spend past its per-window cap and cannot be tricked into paying through unverified code. Nobody (not your server, not the SDK, not a hijacked agent process) can override that.

> **Note:** The spending-limit policy validates the token and the amount. It has no opinion on the recipient. A payment redirected to a different address within the cap satisfies the policy. Guarding the recipient is your application's responsibility.

> **Note:** A spending limit is a fixed (tumbling) window, not a sliding one. Spending timed around a window boundary can move up to 2x the cap in a short span. See [Policies](./policies.md).

## The flow

```
1. Deploy the policies (wallet.policies), e.g. a spending-limit instance and
   a verified-only instance, each attached to the wallet.
2. Generate an agent keypair. YOU hold the secret; the SDK never sees it.
3. wallet.agents.mint(...) adds the agent's public key as a signer whose
   SignerLimits require those policies to co-sign the granted tokens.
   <- the ONE passkey prompt
4. Hand the agent its secret + the wallet's C-address. It pays via
   wallet.x402 under the on-chain budget: no passkey, no admin keys.
5. wallet.agents.revoke(...) removes the key on-chain: the remote kill.
```

## Prerequisites

- **`vellar-sdk` 0.5.0 or later.**
- **A deployed spending-limit policy**, attached to the wallet. See [Policies](./policies.md).
- **An `agentKeys` runtime** wired to `createVellarWallet`, covered in step 1.

## 1. Configure agentKeys

`mint` and `revoke` are wallet-admin actions, so they are passkey-signed through an `agentKeys` runtime you wire to your `PasskeyKit`, exactly like [`policyAttach`](./policies.md). Without it, `wallet.agents` calls throw a clear error and the rest of the wallet still works.

```ts
const vellar = createVellarWallet({
  network: "testnet",
  appName: "My App",
  kit,
  sac,
  backend,
  isValidAddress,
  agentKeys: {
    // Resume the connected passkey without a prompt, when possible.
    resume: (keyId) => resumeKitConnection(kit, keyId),

    // Add the agent key as a policy-limited signer. Build the SignerLimits
    // from the grants, passkey-sign, submit via your backend.
    async addAgentKey({ publicKey, grants, expirationSeconds, store }) {
      const { SignerStore, SignerKey } = await import("passkey-kit");
      const limits = new Map(
        grants.map((g) => [g.token, g.policies.map((p) => SignerKey.Policy(p))]),
      );
      const tx = await kit.addEd25519(
        publicKey,
        limits,
        store === "temporary" ? SignerStore.Temporary : SignerStore.Persistent,
        expirationSeconds,
      );
      const signed = (await kit.sign(tx)) ?? tx;
      const { hash } = await backend.submitTransaction({
        signedXdr: typeof signed === "string" ? signed : signed.toXDR(),
        network: "testnet",
      });
      return { hash };
    },

    async removeAgentKey(publicKey) {
      const { SignerKey } = await import("passkey-kit");
      const tx = await kit.remove(SignerKey.Ed25519(publicKey));
      const signed = (await kit.sign(tx)) ?? tx;
      const { hash } = await backend.submitTransaction({
        signedXdr: typeof signed === "string" ? signed : signed.toXDR(),
        network: "testnet",
      });
      return { hash };
    },
  },
});
```

The SDK stays free of a `passkey-kit` dependency by keeping this a seam, the same reason `policyAttach` is wired on the host side.

## 2. Mint the key

```ts
import { Keypair } from "@stellar/stellar-sdk";

// You generate the agent's keypair and keep the secret. The SDK never
// receives it: only the public key goes on-chain as a signer.
const agentKey = Keypair.random();

const { hash, expiresAt } = await vellar.agents.mint({
  publicKey: agentKey.publicKey(),
  grants: [
    {
      token: usdcSac, // the SEP-41 token the agent may move
      policies: [spendingLimitId, verifiedOnlyId], // both must co-sign
    },
  ],
  expiresAt: new Date(Date.now() + 7 * 864e5), // optional on-chain expiry
  // store: "persistent" (default) | "temporary"
});
```

`grants` is a list of `{ token, policies }`, one per token the agent may transact through. **Each grant must name at least one policy.** An unrestricted grant is deliberately not mintable through `wallet.agents` (mint one through your own kit wiring if you truly intend an unlimited signer). For a budget in more than one token, attach a separate token-scoped policy per token and add a grant for each.

`usdcSac` above is a placeholder: any SEP-41 token's contract id works. On testnet, the Circle USDC Stellar Asset Contract is `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.

`expiresAt` accepts a `Date` or unix **seconds**; an expired key stops signing with no `revoke` needed. `mint` returns the transaction hash and, if set, the ISO expiry.

> ⚠️ **The agent secret is yours to hold.** The SDK never sees or stores it. Keep it in the agent's own secure storage (a non-extractable key where the runtime supports it), never in the browser and never in the wallet app.

## 3. Hand the agent its credentials

The agent needs two things: its own secret, and the wallet's `C...` address. With those it pays via [x402](../x402.md) using `createSessionKeySigner`, under the on-chain budget, with no passkey and no admin keys.

```ts
import { createSessionKeySigner } from "vellar-sdk";

const signer = createSessionKeySigner({
  address: walletContractId,          // the wallet's C... address
  secretKey: agentKey.secret(),       // the agent's own secret
  simulationSourceAccount: simSourceG // a DIFFERENT funded G... account
});
```

> ⚠️ **`simulationSourceAccount` must be a different, separately funded `G...` account from the wallet the agent pays out of.** Simulating from the payer makes Soroban authorize with source-account credentials, which the exact scheme rejects with `invalid_exact_stellar_payload_unsupported_credential_type`. Any funded `G...` keypair works: it never signs and is never charged.

## 4. Revoke a key

```ts
await vellar.agents.revoke(agentKey.publicKey());
```

On-chain removal is immediate: the key stops signing the moment the transaction confirms. This is the remote kill for a lost or misbehaving agent.

The blast radius, stated honestly: a compromised agent key can at worst spend up to its remaining budget through policy-permitted contracts, until it expires or you revoke it. Never the account's full balance, never admin actions, never unverified code.

## Honesty

- **Verified is not safe.** A verified-only grant restricts the agent to contracts with reproducible, attributable source. That is provenance, not an audit and not a safety proof. See [Policies](./policies.md).
- **Expiry plus revoke bound the blast radius.** They do not prevent a compromise; they cap what a compromise can cost and how long it can last.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wallet.agents` calls throw a clear error | No `agentKeys` runtime was wired to `createVellarWallet` | Wire `resume`, `addAgentKey` and `removeAgentKey` as in step 1. The rest of the wallet works without it |
| `mint` fails | A grant named no policy; an unrestricted grant is deliberately not mintable through `wallet.agents` | Give every grant at least one policy contract id |
| Agent payment rejected with `invalid_exact_stellar_payload_unsupported_credential_type` | `simulationSourceAccount` is the payer itself, so Soroban authorized with source-account credentials | Point `simulationSourceAccount` at a different funded `G...` account |
| The key stopped working before `expiresAt` | It was revoked on-chain | Mint a new key. Revocation is permanent for that public key |
| An over-budget payment settles | The policy was not named in the key's `SignerLimits`, so nothing co-signed the token | Re-mint the key with the policy listed in the grant for that token |

## Next steps

- [Policies](./policies.md)
- [MCP payer](./mcp-payer.md)
- [Pay for a resource](../buyers/pay-for-a-resource.md)
- [Spend controls](../buyers/spend-controls.md)
