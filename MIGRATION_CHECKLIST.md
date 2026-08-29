# Session schema migration checklist

This checklist is for any PR that makes a **breaking change to the stored
session schema** — `WalletSession` (`src/types.ts`), `isWalletSession` or the
storage adapters in `src/session.ts`, or anything else a consumer persists
across app versions (e.g. via `createWebStorageAdapter` / `localStorage`).

A "breaking" change is one where a session object written by an older SDK
version would be **misread, rejected, or silently corrupted** by a newer one
— for example: renaming a field, changing a field's type or allowed values,
making an optional field required, or splitting one field into several.
Adding a new **optional** field is not breaking on its own and does not
require this checklist, but see "Backward compatibility" below if the new
field changes how `isWalletSession` validates existing data.

**Every PR that changes the session schema in a breaking way must link to
this checklist in its description** (`Migration checklist: see
MIGRATION_CHECKLIST.md`, with the boxes below checked or explicitly marked
N/A with a reason). A maintainer reviewing a schema PR should not approve it
without that link.

## Why this exists

`WalletSession` is persisted by the **consumer's app**, not by this SDK's own
process — a user can have a session written by SDK 0.6.x sitting in their
browser's `localStorage` for months before they upgrade to an app running SDK
0.7.0. `restore()` in `src/session.ts` reads that old object with the new
code. If the new `isWalletSession` guard doesn't recognize the old shape, the
user is silently signed out (`restore()` is deliberately fail-soft — see its
`catch` block — so a mismatched schema does not crash the app, but it does
lose the session). A breaking schema change shipped without a migration path
degrades every existing user's session on their next app load, all at once,
with no error surfaced anywhere.

## The checklist

### 1. Backward compatibility

- [ ] **Old sessions still parse.** `isWalletSession` (or its replacement)
      accepts BOTH the old shape and the new shape, for at least one full
      minor version cycle. A schema change is not "done" until a session
      object from the previous released version round-trips through
      `restore()` without becoming `null`.
- [ ] **New required fields have a defined fallback for old data.** If the
      new schema adds a field that code elsewhere assumes is always present,
      decide and document what a migrated-from-old-data session gets for
      that field (a computed default, not just `undefined`).
- [ ] **Removed/renamed fields are still read (not just dropped) from old
      data**, if anything downstream depended on them, so the migration step
      (below) has something to read from.
- [ ] **The storage adapters (`createWebStorageAdapter`,
      `createMemoryStorageAdapter`, or a consumer's own
      `SessionStorageAdapter`) are unaffected**, or any adapter change is
      itself covered by this same checklist. The adapters are dumb
      load/save/clear — schema logic belongs in `isWalletSession` and the
      store, not in the adapter.

### 2. Migration helper usage

- [ ] **A migration step runs old data through, rather than discarding it.**
      Today that means: `isWalletSession` (or a small helper it delegates
      to) recognizes the old shape and upgrades it to the new shape in
      memory before the store accepts it — see the worked example below for
      the pattern. If the project has since added a dedicated migration
      module, use that instead and update this line to point at it.
- [ ] **The migration is applied on read (`restore()` / `load()`), not
      required at write time.** A consumer should never have to run an
      explicit "migrate my users" step; the SDK upgrades data the first time
      it's touched.
- [ ] **Migrating a session does not require network access or a passkey
      prompt.** It is a pure, synchronous data transform. If the new schema
      genuinely cannot be derived from old data without asking the user
      again, that is a sign the change needs a softer rollout (see
      "Rollout" below), not a bigger migration function.
- [ ] **The migration is idempotent.** Running it twice (e.g. because
      `restore()` is called more than once, or a future version's migration
      chains on top of this one) produces the same result as running it
      once.

### 3. Testing

- [ ] A test in `src/session.test.ts` constructs a session object in the
      **old** shape and asserts `isWalletSession`/`restore()` accepts it and
      the migrated result has the expected new-shape fields.
- [ ] A test asserts a session in the **new** shape still round-trips
      unchanged (the migration path doesn't double-apply or corrupt
      already-current data — this is the idempotency check from above,
      exercised through the public API).
- [ ] A test asserts genuinely invalid data (neither old nor new shape)
      still returns `null`/disconnected, not a crash — don't loosen the
      guard so much that it stops rejecting garbage.

### 4. Rollout

- [ ] The change is called out in `CHANGELOG.md` under a `### Breaking` (or
      equivalent) heading, naming the exact field(s) affected and how long
      the backward-compatible read path will be kept before it's allowed to
      be dropped.
- [ ] If the migration cannot fully preserve session state (e.g. a field
      that genuinely has no old-data equivalent), the changelog entry says
      what the user-visible effect is (e.g. "existing users will be prompted
      to reconnect once").
- [ ] The backward-compatible read path has a tracked follow-up (an issue or
      a `TODO` referencing one) to remove it once enough time has passed,
      so compatibility code doesn't accumulate forever.

## Worked example (hypothetical)

Say a future change wants to replace the single `lastActiveAt: string` field
on `WalletSession` with a structured `activity: { lastActiveAt: string;
lastActiveNetwork: Network }`, so the stored session can track which network
the user was last active on.

**1. Backward compatibility** — the new `isWalletSession` accepts a session
carrying either `activity` (new) or a bare `lastActiveAt` (old):

```ts
function isWalletSession(value: unknown): value is WalletSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const hasCoreFields =
    typeof v.accountId === "string" &&
    v.accountId.length > 0 &&
    (v.network === "testnet" || v.network === "mainnet") &&
    typeof v.connected === "boolean" &&
    v.authMethod === "passkey" &&
    typeof v.createdAt === "string";
  if (!hasCoreFields) return false;

  // New shape.
  if (typeof v.activity === "object" && v.activity !== null) {
    const a = v.activity as Record<string, unknown>;
    return typeof a.lastActiveAt === "string";
  }
  // Old shape — still valid, migrated below.
  return typeof v.lastActiveAt === "string";
}
```

**2. Migration helper** — applied on read, before the value re-enters the
store, upgrading old data to the new shape and falling back to the
session's own `network` (the best available guess) for the field that
didn't exist before:

```ts
function migrateSession(raw: Record<string, unknown>): WalletSession {
  if (raw.activity) return raw as unknown as WalletSession; // already current
  const { lastActiveAt, ...rest } = raw as { lastActiveAt: string };
  return {
    ...(rest as Omit<WalletSession, "activity">),
    activity: { lastActiveAt, lastActiveNetwork: rest.network as Network },
  } as WalletSession;
}
```

`restore()` and the storage adapters' `load()` run every value through
`migrateSession` after `isWalletSession` confirms it's one shape or the
other, so the store only ever holds current-shape sessions.

**3. Testing** — `src/session.test.ts` gets a case building a session with
the old bare `lastActiveAt` field, asserting `restore()` yields a session
with `activity.lastActiveAt` set correctly and `activity.lastActiveNetwork`
falling back to the session's `network`; a second case confirms a
new-shape session with `activity` already set passes through unchanged.

**4. Rollout** — `CHANGELOG.md` notes that `lastActiveAt` is replaced by
`activity.lastActiveAt` / `activity.lastActiveNetwork`, that both shapes are
read for the next two minor versions, and links a tracking issue to drop the
old-shape read path afterward.
