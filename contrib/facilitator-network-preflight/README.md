# Facilitator Network Preflight

Reference implementation for issue #512. It fetches the facilitator's
`/supported` endpoint, checks that the configured CAIP-2 network is advertised,
and refuses to invoke the signing callback on a mismatch.

Run its stubbed-fetch tests from the repository root:

```sh
npx vitest run contrib/facilitator-network-preflight/preflight.test.ts
```

This remains a contrib-only reference. Wiring the preflight into the CLI and
MCP payer requires changes outside `contrib/`; request that scope on the issue
before attempting those production edits.