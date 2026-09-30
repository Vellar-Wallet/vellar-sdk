# MCP Payer Settled-Budget Reference (#511)

This reference ledger prevents concurrent in-flight requests from each spending
the same remaining session budget. It reserves the requested amount before
payment work begins, then replaces that reservation with the confirmed settled
amount. Failed or cancelled work releases its reservation.

Run the focused tests from the repository root:

```sh
npx vitest run contrib/mcp-payer-wave-511/settled-spend-ledger.test.ts
```

## Core Integration Required

This `contrib/` implementation does not change the live MCP payer. A maintainer
must wire `reserve()` before the first asynchronous payment step in
`createPayer().pay()`, call `settle()` with the confirmed settlement amount,
and call `release()` on paths that establish no funds were spent. Indeterminate
settlement paths must remain conservatively charged rather than released.

Reservation cleanup should be protected with `try`/`catch` or `finally` so an
exception cannot leave budget reserved indefinitely. A confirmed settlement
must replace, not add to, its reservation.