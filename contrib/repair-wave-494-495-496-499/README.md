# Repair wave #494, #495, #496, and #499

This contributor artifact stays inside `contrib/`. The reported defects are in
`src/` and `packages/cli/`, so this PR cannot directly repair those files under
the contributor rule. `core-repairs.patch` is a maintainer lift patch for use
after the requested scope is approved.

From the repository root, check that the patch still applies to the target
branch:

```sh
git apply --check contrib/repair-wave-494-495-496-499/core-repairs.patch
```

After a maintainer applies the patch, run:

```sh
npx vitest run src/x402-signer.test.ts src/session.test.ts packages/cli/src/commands/search.test.ts
npm run typecheck
```

The signer test repair separates the audit-hook and capability suites. Moving
the capability check into each signer's live `try` path is also necessary: the
existing calls after `catch` are unreachable after the successful return or
rethrow. The restored denial cases exercise this behavior.

## Facilitator host confirmation

The #499 patch uses `https://facilitator.vellar.xyz`, a host already present in
a contrib test fixture, and changes the test to assert HTTPS/base-URL shape
rather than pinning a host. This environment could not resolve that hostname,
and the issue does not name a replacement. A maintainer should confirm that the
host is the intended live default before applying that hunk; otherwise update
the constant in the patch to a verified endpoint. The URL-shape assertion by
itself does not establish service availability.