# Session Schema Version

Self-contained reference for issue [#220](https://github.com/Vellar-Wallet/vellar-sdk/issues/220): wrap persisted session cache writes in a versioned envelope and reject unversioned or mismatched reads.

## Run tests

```bash
npx vitest run contrib/examples/issue-220-session-schema-version/session-schema-version.test.ts
```

## Versioning approach

- Current `SESSION_SCHEMA_VERSION` is `1`.
- All writes use `{ schemaVersion, session }`.
- Unversioned legacy blobs and mismatched versions load as `null` (safe disconnected fallback).
