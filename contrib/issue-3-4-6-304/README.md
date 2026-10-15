# Activity, HTTP Resilience, React, and Export Proposal

This contributor-only proposal covers issues #3, #4, #6, and #304. The repository
allows external pull requests to change files only inside `contrib/`, so the SDK
implementation is preserved here as a reviewable patch rather than applied to
the package source.

## Proposed Changes

- **#3 HTTP resilience:** per-request timeout, typed timeout failures, abort
  support, and retries restricted to safe reads.
- **#4 Activity API:** typed cursor-paginated wallet activity backed by the
  gateway's `/wallet/transactions` route.
- **#6 React binding:** optional `vellar-sdk/react` provider and hook with
  observable session updates, wallet actions, loading, and error state.
- **#304 Export surface:** consolidate the root's facade re-exports while
  preserving the canonical stable and experimental entry points.

## Review and Lift

`core-implementation.patch` contains the tested SDK, package, documentation, and
test changes from commit `a802b20`. It is not applied in this branch, so the
published SDK remains unchanged. Maintainers can inspect or apply the patch
after explicitly widening the scope:

```sh
git apply --check contrib/issue-3-4-6-304/core-implementation.patch
git apply contrib/issue-3-4-6-304/core-implementation.patch
```

Before packaging the proposal, 46 focused tests passed. The repository-wide
typecheck, full suite, build, and docs checks were blocked by existing parse
errors in `src/x402-signer.ts`, `src/x402-signer.test.ts`, and
`src/session.test.ts`; those unrelated files are not modified by this proposal.

## Critical Audit Gate Proposal

`security-audit-critical.patch` contains a tested dependency update for the
critical-level npm audit gate. It changes the root and both workspace Vitest
ranges to `^4.1.12`, then applies non-forced npm audit updates. A clean install
resolved `@modelcontextprotocol/sdk` to `1.32.1` and `proxy-addr` to `2.0.8`;
`npm audit --audit-level=critical` then completed without critical findings.

The change does **not** use `npm audit fix --force`. The audit still reports
seven non-critical advisories, including high-severity Stellar SDK/Axios and
TOML dependency findings that would require separate compatibility review. The
full test suite was not re-run against Vitest 4 in this probe; existing source
parse errors also block the repository-wide test/typecheck gates.

Maintainers can review or apply this dependency-only proposal separately:

```sh
git apply --check contrib/issue-3-4-6-304/security-audit-critical.patch
git apply contrib/issue-3-4-6-304/security-audit-critical.patch
```