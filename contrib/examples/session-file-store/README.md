# Wallet session file store

Saves and loads a wallet session to/from a local JSON file, for node-based
tooling (a CLI, a headless agent) that needs to persist a session between
runs without a real browser `Storage` API.

**For examples and tests only — not production.** A real app should use
`createWebStorageAdapter` (or a custom `SessionStorageAdapter`) from
`vellar-sdk`'s `src/session.ts`; a plain JSON file has no encryption and no
concurrent-write protection.

## Run it

```sh
npx tsx session-file-store.ts
```

Expected output:

```
Load before save: null
Saved session to /tmp/vellar-example-session.json
Load after save:  {
  accountId: 'CABC123SAMPLEWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXX',
  network: 'testnet',
  connected: true,
  authMethod: 'passkey',
  createdAt: '2026-01-15T09:30:00.000Z',
  lastActiveAt: '2026-01-15T09:30:00.000Z'
}
```

A missing file on `loadSession()` returns `null` rather than throwing — a
fresh run with no prior saved session is a normal case.

## Tests

Uses a temporary directory per test, cleaned up afterward:

```sh
npx vitest run contrib/examples/session-file-store
```
