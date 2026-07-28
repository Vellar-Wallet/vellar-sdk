# In-memory session store

A minimal in-memory store for a `WalletSession`, exposing `getSession()` and
`setSession()` operating on a module-level variable.

**For examples and tests only — not production.** A real app should persist
sessions with `createWebStorageAdapter` (or a custom `SessionStorageAdapter`)
from `vellar-sdk`'s `src/session.ts`. A plain module-level variable is lost on
reload/restart and is shared globally across everything that imports this
module — there is no per-user or per-tab isolation.

## Run it

```sh
npx tsx memory-session-store.ts
```

Expected output:

```
Before setSession: null
After setSession:  {
  accountId: 'CABC123SAMPLEWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXX',
  network: 'testnet',
  connected: true,
  authMethod: 'passkey',
  createdAt: '2026-01-15T09:30:00.000Z',
  lastActiveAt: '2026-01-15T09:30:00.000Z'
}
```

## Tests

```sh
npx vitest run contrib/examples/memory-session-store
```
