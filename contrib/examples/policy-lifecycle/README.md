# Policy lifecycle without a UI framework

This example drives the public policy facade through the complete lifecycle:
`policies.listTemplates`, `generate`, `simulate`, and `deploy`. An in-memory
gateway implements the policy HTTP endpoints, while a mock attach runtime
stands in for the one passkey-authorized attach operation. No live service,
funded account, browser, or UI framework is required.

```sh
npx tsx contrib/examples/policy-lifecycle/policy-lifecycle.ts
npx vitest run contrib/examples/policy-lifecycle/policy-lifecycle.test.ts
```

Each lifecycle result is logged, making the script useful both as executable
documentation and as a starting point for backend or command-line integrations.
