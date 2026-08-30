# Backfill guide: migrating cached policy data across schema versions

Closes #293.

If your app caches a `GeneratedPolicy` / `PolicyDefinition` locally (e.g. in
`localStorage`, a file, or a mobile app's on-device store) between SDK
upgrades, an older cached blob can predate a schema change. This guide shows
how to detect that and migrate the cached shape forward, following the same
pattern the SDK already uses for `WalletSession` storage in
[`src/session.ts`](../../../src/session.ts): a `load()` that never throws on
unreadable/outdated data, paired with an explicit shape check
(`isWalletSession`) before trusting what came back from storage.

## Why this is needed

Nothing in the policy domain types (`src/policy-types.ts`, `src/types.ts`)
carries a version tag today — a policy blob written to storage by an older
app version and a current one are structurally indistinguishable unless the
consumer adds versioning itself. Without a documented convention, every
consumer that caches policies has to invent their own detection and
migration logic (or, worse, skips it and ships a runtime crash the first
time a returning user's cached policy doesn't match the shape the current
SDK expects).

## The pattern

1. **Stamp a `schemaVersion` field on every policy you write to storage**,
   starting now. See [`stampCurrentVersion`](policy-schema-migration.ts).
2. **On load, detect the version before trusting the shape.** Missing
   `schemaVersion` means "written before this convention existed" — treat it
   as the oldest known shape, not an error. See
   [`detectSchemaVersion`](policy-schema-migration.ts).
3. **Migrate forward through each version in sequence**, the same way you'd
   write a database migration — never jump straight from "unknown old shape"
   to "current shape" with one big conditional. See
   [`migratePolicyToCurrent`](policy-schema-migration.ts), which is
   idempotent: running it on already-current data is a no-op, so it's safe
   to call unconditionally on every load.
4. **Never let a corrupt or unrecognized cache crash the app.** Wrap the
   load + migrate step the same way `SessionStorageAdapter.restore()` does in
   `src/session.ts` — catch, log, and fall back to treating it as "no cached
   policy", not an unhandled exception.

## Detecting an outdated cached schema

```ts
import { detectSchemaVersion, CURRENT_POLICY_SCHEMA_VERSION } from "./policy-schema-migration";

const cached: unknown = JSON.parse(localStorage.getItem("myapp.cachedPolicy") ?? "null");

if (cached !== null) {
  const version = detectSchemaVersion(cached);
  if (version < CURRENT_POLICY_SCHEMA_VERSION) {
    console.warn(`Cached policy is schema v${version}, current is v${CURRENT_POLICY_SCHEMA_VERSION} — migrating`);
  }
}
```

## Migrating a fixture (v1 -> v2)

The old shape (`PolicyV1`) had a single string owner and flat limit fields.
The current shape (`PolicyV2`) supports multiple owners and nests limits
under `spendingLimits`, mirroring `src/types.ts`'s `PolicyDefinition`:

```ts
import { migratePolicyToCurrent } from "./policy-schema-migration";

const legacyCached = {
  policyOwner: "GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  dailyLimit: "100",
  perTxLimit: "20",
  allowlistedContracts: ["CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
};

const migrated = migratePolicyToCurrent(legacyCached);
// {
//   schemaVersion: 2,
//   owners: ["GOWNERAAAA..."],
//   spendingLimits: { dailyXlm: "100", perTxXlm: "20" },
//   allowlistedContracts: ["CUSDCAAAA..."],
// }
```

## Run it

```sh
npx tsx policy-schema-migration.ts
```

## Tests

```sh
npx vitest run contrib/examples/issue-293-policy-schema-migration-guide
```

The test suite runs the documented migration steps against the fixture
above end to end: version detection on an unversioned blob, field-by-field
migration correctness, idempotency on already-current data, and rejection
of an unrecognized future schema version.
