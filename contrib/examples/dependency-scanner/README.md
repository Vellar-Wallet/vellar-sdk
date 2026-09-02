# Dependency Scanner & Vulnerability Policy (Issue #257)

Automated dependency vulnerability scanner and policy evaluation utility for CI pipelines.

## Features
- Scans dependency vulnerability lists against configurable thresholds (default: `high`).
- Automatically fails builds when high or critical CVEs are detected.
- Supports documented risk exceptions with expiration dates and approval metadata.

## Usage

```ts
import { scanVulnerabilities } from "./dependency-scanner";

const result = scanVulnerabilities(vulnerabilities, {
  failSeverity: "high",
  exceptions: [
    {
      id: "GHSA-xxxx-xxxx",
      name: "some-package",
      reason: "Dev-only tool, unexposed in runtime",
      expiresAt: "2026-12-31T00:00:00Z",
    },
  ],
});

if (!result.passed) {
  console.error("Vulnerability check failed:", result.failing);
}
```

## Running Tests

```sh
npx vitest run contrib/examples/dependency-scanner
```
