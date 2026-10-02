# Session Schema Migration

Self-contained reference for issue [#215](https://github.com/Vellar-Wallet/vellar-sdk/issues/215): a migration helper that detects a stored session written by an older SDK version and upgrades it to the current schema, with a dry-run mode that reports whether migration is needed.

## Why

Issue [#220](https://github.com/Vellar-Wallet/vellar-sdk/issues/220) introduced the `{ schemaVersion, session }` envelope and made every pre-envelope blob load as `null`. That is safe, but it silently logs users out the moment a consumer bumps the SDK. This helper is the other half: a v0 or v1 blob is **upgraded in place** instead of discarded, so the session survives the upgrade.

## Run tests

```bash
npx vitest run contrib/examples/issue-215-session-schema-migration/session-schema-migration.test.ts
```

## Schema history

| Version | Shape | Written by |
|---------|-------|------------|
| `0` | bare `WalletSession` (no wrapper) | SDK <= 0.5.x |
| `1` | `{ schemaVersion: 1, session }` | envelope from issue #220 |
| `2` | `{ schemaVersion: 2, session, migratedAt? }` | current — `migratedAt` is set only on upgraded records |

`SESSION_SCHEMA_VERSION` is `2`. `KNOWN_SCHEMA_VERSIONS` lists every version this helper can read.

## Usage

### Check before upgrading (dry run)

```ts
import { dryRunMigration } from "./session-schema-migration";

const report = dryRunMigration(JSON.parse(localStorage.getItem("vellar.session")!));

report.needsMigration; // true
report.from;           // 0
report.to;             // 2
report.reason;         // "Stored session is at schema v0; upgrade to v2 is required."
```

Nothing is written in dry-run mode and `envelope` is never produced.

### Migrate a value

```ts
import { migrateStoredSession } from "./session-schema-migration";

const { outcome, envelope } = migrateStoredSession(storedValue);
if (outcome === "migrated" && envelope) {
  localStorage.setItem("vellar.session", JSON.stringify(envelope));
}
```

### Migrate storage in place

```ts
import { migrateStorage } from "./session-schema-migration";

// Reads, upgrades, and writes back. Idempotent — a second call is a no-op.
const result = migrateStorage(localStorage, "vellar.session");

// Optionally drop a blob that cannot be read at all:
migrateStorage(localStorage, "vellar.session", { clearUnsupported: true });
```

### Drop-in load path

```ts
import { loadAndMigrateSession } from "./session-schema-migration";

// Where the v1 loader returned null for a legacy blob, this upgrades and returns it.
const session = loadAndMigrateSession(localStorage, "vellar.session");
```

## Outcomes

| `outcome` | `needsMigration` | Meaning |
|-----------|------------------|---------|
| `up-to-date` | `false` | Already at `SESSION_SCHEMA_VERSION`; nothing to write |
| `migrated` | `true` | A known prior version was (or would be) upgraded |
| `unsupported` | `false` | Corrupt, empty, or stamped with a version newer than this SDK — nothing is written |

`unsupported` is deliberately **not** an error. Migration never throws: malformed JSON, a missing key, and a future `schemaVersion` all report `unsupported` so a consumer's startup path can fall back to disconnected exactly as it does today. A future version is never downgraded.

## Migration behaviour notes

- The upgraded session is copied field by field, so unknown keys carried by an old blob do not ride along into the new record.
- Absent optional fields (`serverSessionId`, `keyId`) are omitted rather than written as `undefined`.
- `migratedAt` distinguishes an upgraded record from a natively-written one. `wrapSession` (fresh writes) does not set it.
- The clock is injectable via `now` so tests can pin `migratedAt`.
