# Timeout budgets for policy-client deployment RPC calls

Closes #276.

`src/policy-client.ts`'s `createPolicyClient` issues `simulate`,
`deployInstance`, and `recordDeployment` requests through a shared
`req<T>()` helper that calls the injected `fetch` with no timeout at all —
a stalled network connection or a slow gateway hangs the call indefinitely,
with no way for a caller to bound how long they're willing to wait. Because
contributor changes are confined to `contrib/`, this entry provides a
self-contained, directly-portable implementation of the fix
([`policy-deploy-timeout.ts`](policy-deploy-timeout.ts)) that a maintainer
can fold into `src/policy-client.ts`.

## What changes in `policy-client.ts`

1. **A configurable timeout budget per RPC call**, not one blanket timeout
   for the whole client — `simulate`, `deployInstance`, and
   `recordDeployment` have different expected latencies (simulate is a dry
   run; deploy/record involve on-chain interaction server-side), so each
   gets its own default and its own override:

   ```ts
   export interface PolicyDeployTimeoutBudgets {
     simulate: number;
     deployInstance: number;
     recordDeployment: number;
   }

   export const DEFAULT_POLICY_DEPLOY_TIMEOUTS: PolicyDeployTimeoutBudgets = {
     simulate: 10_000,
     deployInstance: 30_000,
     recordDeployment: 15_000,
   };
   ```

   `PolicyClientOptions` would grow an optional `timeouts?: Partial<PolicyDeployTimeoutBudgets>`
   field, merged over the defaults the same way `options.timeouts` is merged
   in [`createTimedPolicyDeployClient`](policy-deploy-timeout.ts).

2. **A distinct typed timeout error**, `PolicyDeployTimeoutError`, thrown via
   `AbortController` + `setTimeout` inside the shared request helper. It is
   deliberately **not** a `PolicyApiError` subclass:

   - `PolicyApiError` means the server responded and said no — per the
     existing `retryable` logic in `src/policy-types.ts`, that's sometimes
     retryable (5xx, 429, 408) and sometimes not (4xx in general).
   - `PolicyDeployTimeoutError` means no response was ever received — we
     never learned what the server decided. A caller can choose to retry
     with a longer budget, but should not conflate this with "the server
     rejected the deploy."

   Keeping them as separate types (rather than, say, `PolicyApiError` with
   `status: 0`, which is already used for transport failures) lets a caller
   `catch` and branch on `instanceof` without inspecting a status code, and
   keeps "we gave up waiting" legible as its own failure mode when read out
   of a stack trace or an error-tracking dashboard.

## Applying this to the real client

In `src/policy-client.ts`, the `req<T>()` helper's `doFetch(...)` call would
gain an `AbortController` scoped to the timeout for that specific call site,
with `deployInstance`/`recordDeployment`/`simulate` each passing their own
budget from `PolicyClientOptions.timeouts` (falling back to
`DEFAULT_POLICY_DEPLOY_TIMEOUTS`), exactly as shown in
[`createTimedPolicyDeployClient`](policy-deploy-timeout.ts). The
`AbortError` case is caught and re-thrown as `PolicyDeployTimeoutError`
before it can surface as an opaque `AbortError` to the caller.

## README documentation for the option

The SDK's top-level README's policy-client usage section should document
the new option next to `apiUrl`/`network`/`fetch`:

```ts
const policyClient = createPolicyClient({
  apiUrl: "https://api.example.com",
  network: "testnet",
  // Optional per-call timeout budgets (ms) for the deployment RPC calls.
  // Falls back to DEFAULT_POLICY_DEPLOY_TIMEOUTS for any field not given.
  timeouts: { deployInstance: 45_000 },
});
```

## Run it

```sh
npx tsx policy-deploy-timeout.ts
```

Demonstrates a `simulate` call against a mock fetch that takes 5s to
resolve, configured with a 200ms budget — the call throws
`PolicyDeployTimeoutError` instead of hanging.

## Tests

```sh
npx vitest run contrib/examples/issue-276-rpc-timeout-budget
```

Covers: a call resolving normally inside its budget, a call timing out as
configured, budgets tracked independently per call (`simulate` timing out
doesn't affect `deployInstance`'s separate budget), unset budgets falling
back to the documented defaults, the timeout error carrying the path and
configured timeout, and a non-timeout error (e.g. DNS failure) propagating
unchanged rather than being misreported as a timeout.
