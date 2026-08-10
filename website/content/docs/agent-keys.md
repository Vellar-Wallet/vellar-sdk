# Agent Keys

Mint scoped **agent session keys** — *give your agent a budget, not your keys.*

An agent key is a real on-chain signer on the user's smart wallet, restricted
so it can only move specific tokens, and only when the **policy contracts** you
attach co-sign inside the wallet's `__check_auth`. The chain enforces the
result: an autonomous agent holding the key can pay for things on its own, but
cannot spend past its per-window cap or step outside its policies — even if
the key is fully compromised.

> Requires `vellar-sdk` ≥ 0.5.0. The SDK exposes this as `wallet.agents`.

## Why this is different from a software budget

Most agent-payment tools enforce spending limits in code the agent runs, or in
a gateway it calls — a rule the agent could bypass if compromised. A Vellar
agent key's limits live in the smart wallet's `__check_auth`, so they are
checked by **consensus** every time the agent signs. Stack two policies and
both are enforced on-chain:

- a **spending-limit** policy — *how much* (a cumulative fixed-window cap),
- a **verified-only** policy — *through what* (only contracts whose source is
  attested as verified; see [Policies](./policies.md)).

A key restricted by both can pay for API calls all day, but cannot spend past
its per-window cap (at most 2× the cap in a short span around a window reset —
see [Policies](./policies.md#honesty)) and cannot be tricked into paying
through unverified code. Nobody — not your server, not the SDK, not a hijacked
agent process — can override that.

## The flow

```
1. Deploy the policies (wallet.policies) — e.g. a spending-limit instance and
   a verified-only instance, each attached to the wallet.
2. Generate an agent keypair. YOU hold the secret; the SDK never sees it.
3. wallet.agents.mint(...) adds the agent's public key as a signer whose
   SignerLimits require those policies to co-sign the granted tokens.
   ← the ONE passkey prompt
4. Hand the agent its secret + the wallet's C-address. It pays via
   wallet.x402 under the on-chain budget — no passkey, no admin keys.
5. wallet.agents.revoke(...) removes the key on-chain — the remote kill.
```

## Minting a key

```ts
import { Keypair } from "@stellar/stellar-sdk";

// You generate the agent's keypair and keep the secret. The SDK never
// receives it — only the public key goes on-chain as a signer.
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

`grants` is a list of `{ token, policies }` — one per token the agent may
transact through. **Each grant must name at least one policy**; an
unrestricted grant is deliberately *not* mintable through `wallet.agents`
(mint one through your own kit wiring if you truly intend an unlimited signer).
For a budget in more than one token, attach a separate token-scoped policy per
token and add a grant for each.

`expiresAt` accepts a `Date` or unix **seconds**; an expired key stops signing
with no `revoke` needed. `mint` returns the transaction hash and, if set, the
ISO expiry.

## Revoking a key

```ts
await vellar.agents.revoke(agentKey.publicKey());
```

On-chain removal is immediate — the key stops signing the moment the
transaction confirms. This is the remote kill for a lost or misbehaving agent.

## Configuration

`mint` and `revoke` are wallet-admin actions, so they are passkey-signed
through an `agentKeys` runtime you wire to your `PasskeyKit` — exactly like
[`policyAttach`](./policies.md). Without it, `wallet.agents` calls throw a
clear error; the rest of the wallet still works.

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

The SDK stays free of a `passkey-kit` dependency by keeping this a seam — the
same reason `policyAttach` is wired the host side.

## Honesty

- **The agent secret is yours to hold.** The SDK never sees or stores it. Keep
  it in the agent's own secure storage (a non-extractable key where the runtime
  supports it); never in the browser or the wallet app.
- **Verified ≠ safe.** A verified-only grant restricts the agent to contracts
  with reproducible, attributable source — *provenance*, not an audit or a
  safety proof. See [Policies](./policies.md).
- **Expiry + revoke bound the blast radius.** A compromised agent key can, at
  worst, spend up to its remaining budget through verified contracts until it
  expires or you revoke it — never the account's full balance, never admin
  actions, never unverified code.

Once minted, the agent pays with [x402](./x402.md) using
`createSessionKeySigner`. Together that is the full loop: *give your agent a
budget, not your keys.*
