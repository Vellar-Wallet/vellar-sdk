# Contributing to the Vellar SDK

Thanks for your interest in contributing! Please read these rules before you
start — pull requests that don't follow them will be closed.

## The rules

1. **Fork the repo and work from your fork.** Clone your fork, make your
   changes on a branch there, and push to your fork. Never push to this
   repository directly.

   ```sh
   gh repo fork Vellar-Wallet/vellar-sdk --clone
   cd vellar-sdk
   git checkout dev
   git checkout -b my-change
   # ...work, commit...
   git push -u origin my-change
   ```

2. **All pull requests must target the `dev` branch — never `main`.**
   When you open a PR, set the base branch to `dev`. PRs opened against
   `main` are automatically retargeted to `dev` by a bot (your work is kept,
   you don't need to reopen anything — just set the base to `dev` yourself
   next time). `main` is the release branch and is managed by maintainers
   only.

3. **Contributor changes must stay inside `contrib/`.** External PRs that
   touch any file outside `contrib/` are closed automatically by a bot, even
   if they also target `dev` correctly. See [contrib/README.md](contrib/README.md)
   for what belongs there. If your assigned issue genuinely requires changes
   elsewhere in the codebase, say so on the issue before starting — a
   maintainer will make that change or explicitly widen your scope.

4. **Only work on issues assigned to you.** If you want to pick something up,
   comment on the issue and wait to be assigned before starting. Unsolicited
   PRs for unassigned issues will be closed.

5. **Questions go to the Telegram group.** Don't open issues for questions —
   ask in [our Telegram](https://t.me/+RWPCKXXJTj45Njk0).

## Before you open a PR

Make sure the package still typechecks, tests, and builds:

```sh
npm install
npm run typecheck
npm test
npm run build
```

New code is expected to come with tests.

## Testing

The default suite is hermetic — no network, no local stack, no chain:

```sh
npm test
```

### Integration harness (client ↔ http-backend)

`src/client-backend-harness.test.ts` wires `client.ts` to a real (loopback) mock
backend server via `http-backend.ts`, exercising wallet initialization, a
balance fetch, and a payment submission over the actual gateway transport
`createHttpWalletBackend` targets. It runs inside `npm test` (the server is
local only). To run just that harness:

```sh
npx vitest run src/client-backend-harness.test.ts
```

### tx-rpc chaos test (network drops mid-poll)

`src/tx-rpc.chaos.test.ts` simulates the RPC network dropping while
`waitForTransaction` is polling for a transaction. A reader stands in for
`createRpcTxStatusReader` and throws exactly as the live RPC does on a drop,
then recovers after a configurable number of failures. The test asserts that
polling resumes and eventually resolves with the correct final status
(`success` / `failed`) rather than wedging or bailing on the first transient
error. Run it in isolation with:

```sh
npx vitest run src/tx-rpc.chaos.test.ts
```

### Load test (concurrent payments submissions)

`src/payments.load.test.ts` is an **optional** load test (not part of `npm
test`) that simulates many concurrent payment submissions through
`payments-client` and measures latency + error rate at increasing concurrency.
Run it locally with:

```sh
npm run test:load
```

It prints a per-concurrency report (p50/p95 latency, error %, and throughput)
and asserts that no submission is lost silently. It is also exposed as an
optional CI job (`load-test`) — trigger it manually via the workflow's "Run
workflow" button; it does not gate normal PRs.

*Observed behavior & bottlenecks.* The SDK's payment path is a fully
asynchronous, shared-nothing promise chain, so a single Node process has no
in-process serialization: with an in-process backend modeled at ~5 ms latency,
error rate stays 0 and throughput scales roughly with concurrency (≈ `(1000 /
latency) × concurrency` submissions/s) up to the transport. The real bottleneck
is therefore the backend/relayer round-trip, not client code — the harness
models this via `BACKEND_LATENCY_MS` and the `failEveryN` error knob. Expect concrete
numbers to vary by machine and by real backend; trust `npm run test:load`'s
report over any fixed figure here.
