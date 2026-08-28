# Cleanup plan viewer

`renderCleanupPlan(plan)` takes a mock cleanup plan object and renders a
readable, numbered, step-by-step view of its blockers. Each blocker is
clearly marked `[RESOLVED]` or `[OUTSTANDING]`. A plan with **zero**
blockers prints a clear all-clear message instead of an empty list.

## Input shape

```ts
interface CleanupBlocker {
  id: string;
  description: string;
  resolved: boolean;
}

interface CleanupPlan {
  title: string;
  blockers: CleanupBlocker[];
}
```

Each rendered step follows the plan's `blockers` order:
`<n>. [RESOLVED|OUTSTANDING] <description> (<id>)`.

## Run it

```sh
npx tsx cleanup-plan-viewer.ts
```

Expected output (a plan with a mix of resolved and outstanding blockers,
followed by a plan with zero blockers):

```
Testnet contract cleanup

1. [RESOLVED] Revoke unused deployer signer key (blocker-1)
2. [OUTSTANDING] Migrate policy-contract owners off the legacy multisig (blocker-2)
3. [RESOLVED] Remove stale allowlist entries from spending-limit policy (blocker-3)
4. [OUTSTANDING] Confirm no active sessions reference the retired signer (blocker-4)

Mainnet migration cleanup

All clear — no blockers remaining.
```

## Tests

```sh
npx vitest run contrib/examples/cleanup-plan-viewer
```
