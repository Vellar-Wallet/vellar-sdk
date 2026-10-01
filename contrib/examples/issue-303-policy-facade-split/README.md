# Policy Facade Read/Write Split

Self-contained reference for issue [#303](https://github.com/Vellar-Wallet/vellar-sdk/issues/303): splitting `policy-facade.ts` into read and write operation modules, so side effects are easier to reason about.

## Run tests

```bash
npx vitest run contrib/examples/issue-303-policy-facade-split
```

## The split

[`src/policy-facade.ts`](../../../src/policy-facade.ts) currently mixes a template listing, a dry-run simulation, and a three-step passkey-signed on-chain deploy in one factory. Reading it, there is no way to tell which call spends money without reading each body.

| Module | Operations | Can calling it twice change anything? |
| --- | --- | --- |
| [`policy-reads.ts`](./policy-reads.ts) | `listTemplates`, `validate`, `simulate`, `listPolicies` | No |
| [`policy-writes.ts`](./policy-writes.ts) | `generate`, `deploy` | Yes |
| [`policy-facade-split.ts`](./policy-facade-split.ts) | composes both | — |

The boundary is drawn on one question: **can calling this twice change anything?** Not on HTTP method, which is misleading here in both directions:

- **`validate()` is a POST but a read.** It's a POST only because a policy definition is too large for a query string. It decides nothing and stores nothing.
- **`generate()` looks like a pure transform but is a write.** The gateway *persists* what it returns — the result carries a `status` that later moves `generated → instance_deployed → deployed`. Calling it twice creates two policies.

That pair is the reason the split is worth making: neither classification is obvious from the call site, and today nothing records the answer.

## What `deploy()` actually does

The one operation in the SDK that triggers a WebAuthn prompt, in three ordered steps:

1. **`deployInstance`** — server-side, sponsor-funded contract deploy bound to the wallet. Spends the sponsor's funds.
2. **`attachPolicy`** — passkey-signed `kit.addPolicy`, submitted on-chain. The **only** passkey prompt.
3. **`recordDeployment`** — records the completed attach.

**The order is a correctness property**, asserted directly in the tests. Recording before attaching would mark a policy deployed that never attached; attaching before deploying the instance has nothing to attach.

**It is deliberately not retryable.** Re-running a failed `deploy()` from the top deploys a *second* contract instance and prompts for a second signature. Only the caller knows whether step 2's prompt was declined (safe to retry) or step 3 merely failed to record an attach that already landed on-chain (must not redeploy — reconcile instead). The tests pin both cases.

The missing-runtime check runs **before** step 1, so a wallet that cannot complete the flow never spends the sponsor's funds on an instance it can never attach.

## Usage

```ts
import { createSplitPolicyFacade } from "./policy-facade-split";

const facade = createSplitPolicyFacade({ client, requireSession, attach });

await facade.listTemplates();   // read
await facade.simulate("pol-1"); // read
await facade.deploy("pol-1");   // write — passkey prompt, on-chain
```

The composed facade has **exactly** the members `createPolicyFacade` returns today, so the split is invisible to callers and existing tests pass unchanged — the requirement the issue sets. Either half can also be used alone:

```ts
import { createPolicyReads } from "./policy-reads";

// No attach runtime needed: reads never prompt for a passkey.
const reads = createPolicyReads({ client, requireSession });
```

## What the split buys

Since the public surface is identical, the value is entirely in the boundary:

- "Can this mutate anything?" is answered by *which file* an operation is in, not by reading its body.
- The read half is constructible and testable without an attach runtime.
- A new operation must be classified to be added at all, so the boundary can't erode quietly.

The composition itself stays deliberately dumb — spread both halves, expose the client — so there is no logic to keep in sync with the two modules that do the work.

## Tests

23 tests, structured as the issue asks: module-level tests for each extracted piece, plus a parity suite for the composition.

The read module's central test asserts the invariant the whole split exists to protect — after calling every read, no mutating client method has been touched:

```ts
expect(client.generate).not.toHaveBeenCalled();
expect(client.deployInstance).not.toHaveBeenCalled();
expect(client.recordDeployment).not.toHaveBeenCalled();
```

## A behavioural difference worth flagging

`simulate` here is `async`; in `src/policy-facade.ts` it is not. That matters when no wallet is connected: the current implementation calls `deps.requireSession()` synchronously, so `simulate()` **throws at the call site** instead of returning a rejected promise. A caller writing

```ts
try {
  await wallet.policies.simulate(id);
} catch { /* ... */ }
```

still catches it, but a caller doing `wallet.policies.simulate(id).catch(...)` does not — the throw escapes before a promise exists. `src/x402-facade.ts` already documents avoiding exactly this, wrapping its methods so "a synchronous `client()` throw (missing config) surfaces as a rejected promise, not a thrown exception at the call site".

Making `simulate` async aligns the two facades. It is a small behavioural change, so it is called out here rather than folded in silently — the test `simulate fails locally when no wallet is connected` covers it.

## Moving this into the SDK

`createSplitPolicyFacade` takes an already-constructed `client` rather than an `apiUrl`, so both halves share one instance and the example runs without a network. In `src/`, that is where `createPolicyClient({ apiUrl, network, fetch })` would be called, exactly as `createPolicyFacade` does today — the rest transfers unchanged.

## Limits

The types in [`policy-facade-types.ts`](./policy-facade-types.ts) mirror `src/policy-types.ts` and `src/policy-client.ts` structurally rather than importing them, keeping this example self-contained. When the split moves into `src/`, they collapse to plain imports — nothing here is new API surface.
