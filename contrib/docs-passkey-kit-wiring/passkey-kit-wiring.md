# Wiring AgentKeyRuntime to PasskeyKit

> The exact contract `wallet.agents` expects from the host, and a complete reference implementation of `AgentKeyRuntime` wired to a real `PasskeyKit`.

By the end of this page you will have a working `agentKeys` runtime: `addAgentKey` and `removeAgentKey` that passkey-sign and submit, plus the optional `resume` that reattaches the connected passkey without a prompt.

`AgentKeyRuntime` is a deliberately narrow seam. The SDK stays free of a `passkey-kit` dependency, so everything that touches the passkey lives in your code. For what the facade does with the runtime, see [Agent Keys](./agent-keys.md).

## The contract

| Method | Required | Called by | Must return |
| --- | --- | --- | --- |
| `addAgentKey({ publicKey, grants, expirationSeconds, store })` | Yes | `wallet.agents.mint` | `{ hash }` of the submitted transaction |
| `removeAgentKey(publicKey)` | Yes | `wallet.agents.revoke` | `{ hash }` of the submitted transaction |
| `resume(keyId)` | No | Before each `mint` and `revoke`, when the session has a `keyId` | Nothing; resolves once the kit is connected |

`expirationSeconds` is already converted to unix **seconds** and is absent when no expiry was requested. `store` is always set (`"persistent"` unless the caller chose otherwise). Input validation (G-address, C-address contract ids, at least one policy per grant) happens in the facade before your runtime runs, so the runtime does not repeat it.

## Reference wiring

```ts
import type { AgentKeyRuntime } from "vellar-sdk";
import { resumeKitConnection } from "vellar-sdk";
import { SignerKey, SignerStore } from "passkey-kit";

const toXdr = (s: unknown) => (typeof s === "string" ? s : (s as { toXDR(): string }).toXDR());
const submit = async (tx: unknown) => {
  const signed = (await kit.sign(tx)) ?? tx; // the ONE passkey prompt
  return backend.submitTransaction({ signedXdr: toXdr(signed), network: "testnet" });
};

export const agentKeys: AgentKeyRuntime = {
  resume: (keyId) => resumeKitConnection(kit, keyId),
  async addAgentKey({ publicKey, grants, expirationSeconds, store }) {
    const limits = new Map(grants.map((g) => [g.token, g.policies.map((p) => SignerKey.Policy(p))]));
    const storage = store === "temporary" ? SignerStore.Temporary : SignerStore.Persistent;
    return submit(await kit.addEd25519(publicKey, limits, storage, expirationSeconds));
  },
  removeAgentKey: async (publicKey) => submit(await kit.remove(SignerKey.Ed25519(publicKey))),
};
```

`kit` is your connected `PasskeyKit` and `backend` is the object you already pass to `createVellarWallet`; its `submitTransaction` returns `{ hash }`. Pass the runtime in the wallet config:

```ts
import { createVellarWallet } from "vellar-sdk";

const vellar = createVellarWallet({
  network: "testnet",
  appName: "My App",
  kit,
  sac,
  backend,
  isValidAddress,
  agentKeys,
});
```

## Why each piece is there

- **`SignerKey.Policy(p)` per policy.** The grant becomes the signer's `SignerLimits`: `token -> [Policy(...)]`. Every listed policy must co-sign that token inside `__check_auth`.
- **`kit.sign` is the only prompt.** Minting and revoking are wallet-admin actions, so they are passkey-signed. Nothing signs silently.
- **Submission goes through your backend.** The relayer credentials stay server-side, the same as for wallet creation.
- **`resume` skips the discovery ceremony.** `resumeKitConnection` is a no-op when the kit is already connected, and calls `connectWallet({ keyId })` after a page reload. Without it, `kit.sign` throws a not-connected error on a fresh kit. Omit `resume` only if your kit is always connected.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wallet.agents` throws `AgentsNotConfiguredError` | `agentKeys` was not passed to `createVellarWallet` | Pass the runtime in the config |
| `kit.sign` throws a not-connected error | The kit was recreated (page reload) and `resume` is missing | Wire `resume` with `resumeKitConnection` |
| `mint` or `revoke` rejects after the prompt | `backend.submitTransaction` failed | The runtime does not swallow it: the error reaches the caller and no hash is returned. Retry after fixing the backend |
| The user dismisses the passkey prompt | `kit.sign` rejects | The rejection propagates; nothing was submitted |
| `mint` throws `InvalidAgentInputError` | Bad key, token, policy id or past `expiresAt` | Caught by the facade before your runtime is called |

## Next steps

- [Agent Keys](./agent-keys.md)
- [Policies](./policies.md)
- [Spending Policies](../architecture/spending-policies.md)
