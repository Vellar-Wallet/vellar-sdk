# Signer audit trail formatter

`formatAuditTrail(events)` takes a list of signer change events (`add`,
`update`, `remove`) and renders them as a readable chronological trail —
**oldest first**. Input order is never assumed to already be sorted: events
are sorted by `timestamp` before rendering, so passing them in any order
(e.g. as fetched newest-first from an API) still produces a correct trail.

## Input shape

```ts
interface SignerChangeEvent {
  action: "add" | "update" | "remove";
  keyType: "ed25519" | "passkey" | "policy-contract";
  signerId: string;
  timestamp: string; // ISO 8601
}
```

Each rendered line includes the action, the signer key type, and the
timestamp: `[<timestamp>] <Action> <keyType> signer (<signerId>)`.

## Run it

```sh
npx tsx signer-audit-trail.ts
```

Expected output (the sample events are given out of order; the trail is
still oldest-first):

```
[2026-01-10T12:00:00Z] Added passkey signer (device-alice-iphone)
[2026-02-01T16:45:00Z] Added ed25519 signer (session-key-1)
[2026-02-14T08:30:00Z] Updated policy-contract signer (spending-limit-policy)
[2026-03-03T09:15:00Z] Removed ed25519 signer (session-key-1)
```

## Tests

```sh
npx vitest run contrib/examples/signer-audit-trail
```
