# Dependency Vulnerability Policy & Exception Process

## Policy Overview

The Vellar SDK enforces automated dependency vulnerability scanning in CI workflows (`.github/workflows/ci.yml`).

- **Audit Level**: CI runs `npm run audit` (`npm audit --audit-level=high`).
- **Failure Threshold**: The build **fails** if any vulnerability with `high` or `critical` severity is discovered.
- **Scope**: Covers direct dependencies, transitive dependencies, and workspace packages (`@vellar/mcp-x402-payer`).
- **Remediation Strategy**: Lockfile-only fixes (`npm update` / `npm audit fix`) are preferred. Where a range bump in `package.json` is required, changes are explicitly evaluated and tested.

---

## Exception Process for Accepted Risks

In circumstances where an upstream package has an open advisory with `high` or `critical` severity, but:
1. The vulnerable code path is provably unreachable in the SDK's execution context (e.g. dev-only tool, unused submodule), OR
2. No upstream fix is yet published and the risk is mitigated by environmental controls,

an **Accepted Risk Exception** may be granted following this process:

### 1. Risk Assessment & Investigation
Before requesting an exception, verify:
- **Reachability**: Is the vulnerable code or method imported or callable by consumers or SDK internals?
- **Impact**: Does the issue affect runtime security, cryptographic integrity, or user credentials?
- **Upstream status**: Is an upstream patch or workaround PR available?

### 2. File an Exception Request
Open a tracking issue in the repository with title `[Security Exception] <Package Name> - <CVE / GHSA ID>`. Include:
- Advisory link (CVE / GHSA ID) and affected package version.
- Severity rating and CVSS score.
- Technical justification explaining why the vulnerability is not exploitable in this SDK.
- Mitigation or compensatory controls in place.
- Upstream fix tracking link.

### 3. Maintainer Review & Approval
An exception requires approval from at least one core maintainer. Once approved:
- The issue is labeled `security-exception`.
- The exception is recorded in the table below with an expiry date (maximum 90 days).
- If a temporary override is required to unblock CI, use `overrides` in `package.json` with a comment pointing to the tracking issue.

### 4. Active Exceptions Log

| Package | Advisory ID | Severity | Scope | Justification | Expiry Date | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| *(None)* | — | — | — | — | — | Active |

### 5. Expiry and Review
- All exceptions are reviewed on every minor release or upon expiry (whichever comes first).
- Once an upstream patch is released, the dependency must be updated and the exception closed.

---

## Local Verification

To run the dependency scan locally:
```sh
npm run audit
```
