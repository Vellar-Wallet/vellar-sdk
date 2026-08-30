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

## Integration testing

Hermetic (`npm test`) never touches the network. A separate, deliberate suite
runs only when you opt in and point it at a **local** stack:

```sh
npm run test:integration
```

It makes real payments on testnet against a locally-running facilitator and
seller (see `packages/mcp-x402-payer/README.md` → "Integration tests" for the
full provisioning recipe). The harness refuses to talk to a hosted facilitator
— the first settlement for a resource URL writes a permanent public catalog
entry — and skips the suite when the environment is unconfigured.

### x402 payment × policy enforcement scenario

`test/integration/layer2.integration.test.ts` and
`test/integration/sdk-x402-policy.integration.test.ts` cover the same
end-to-end claim from two angles: payment authorization checked against a
smart account's on-chain **spending-limit policy**.

- **Within policy** → the payment is authorized and settles on-chain (the
  settlement hash is re-verified against Horizon, never trusted from the
  response).
- **Violating policy** → the payment is **correctly rejected by the chain**.
  `maxAmount` is deliberately set above the over-cap price so no client-side
  guard can be the thing that refuses — only the wallet contract's `__check_auth`
  invoking the policy can.

The MCP variant drives the flow through the payer's `@x402/core` scheme client;
the SDK variant uses the SDK's own `createX402Client` + `createSessionKeySigner`
(with the policy-bearing signer) directly. Both require a provisioning step: a
policy-governed smart account whose session key has a policy contract attached,
plus an under-cap and an over-cap seller.
