# Session schema migration checklist

Use this checklist for any PR that makes a **breaking change to the stored
session schema** — `WalletSession` (`src/types.ts`), `isWalletSession` or the
storage adapters in `src/session.ts`, or anything else a consumer persists
across app versions.

A change is **breaking** when a session object written by an older SDK version
would be misread, rejected, or silently corrupted by a newer one: renaming a
field, changing its type or allowed values, making an optional field required,
or splitting one field into several. Adding a new **optional** field is not
breaking on its own and does not need this checklist.

> **Reference this checklist in your PR description.** A migration PR should
> link here and either check every box or mark one N/A with a reason, e.g.
> `Migration checklist: contrib/examples/issue-282-session-schema-migration-checklist/CHECKLIST.md`.
> Reviewers should ask for it when it's missing.

## Why this exists

`WalletSession` is persisted by the **consumer's app**, not by the SDK's own
process. A user can have a session written by SDK 0.6.x sitting in
`localStorage` for months before their app upgrades. `restore()` in
`src/session.ts` then reads that old object with the new code, and it is
deliberately fail-soft — unreadable storage means "disconnected", never a
crash. So a breaking schema change shipped without a migration path silently
signs every existing user out on their next app load, all at once, with no
error surfaced anywhere.

## 1. Backward compatibility

- [ ] **Old sessions still parse.** `isWalletSession` (or its replacement)
      accepts BOTH the old and new shapes, for at least one full minor
      version cycle. A session from the previous release must round-trip
      through `restore()` without becoming `null`.
- [ ] **New required fields have a defined fallback for old data.** Decide and
      document what a migrated-from-old-data session gets — a computed
      default, not `undefined` for downstream code to trip over.
- [ ] **Removed/renamed fields are still read from old data** (not merely
      dropped), so the migration step has something to read from.
- [ ] **The guard was widened, not disabled.** Genuinely invalid data must
      still be rejected. Don't loosen it so far it stops rejecting garbage.
- [ ] **Storage adapters are unaffected**, or an adapter change is itself
      covered by this checklist. Adapters are dumb load/save/clear — schema
      logic belongs in the guard and the store.

## 2. Migration helper usage

- [ ] **A migration step upgrades old data rather than discarding it.** The
      guard recognises the old shape and a helper upgrades it in memory before
      the store accepts it.
- [ ] **The migration runs on READ** (`restore()` / `load()`), not at write
      time. A consumer should never run an explicit "migrate my users" step.
- [ ] **It is pure and synchronous** — no network, no passkey prompt. If the
      new schema genuinely can't be derived from old data, the change needs a
      softer rollout, not a bigger migration function.
- [ ] **It is idempotent.** Running it twice — repeated `restore()` calls, or a
      future migration chaining on top — gives the same result as running it
      once.
- [ ] **It does not mutate its input.**

## 3. Testing

- [ ] A test constructs a session in the **old** shape and asserts the guard
      and read path accept it, with the migrated result carrying the expected
      new-shape fields.
- [ ] A test asserts a **new**-shape session round-trips unchanged (the
      migration doesn't double-apply or corrupt current data).
- [ ] A test asserts genuinely invalid data still yields `null` /
      disconnected, not a crash.
- [ ] A test asserts the fallback value for any newly required field.

## 4. Rollout

- [ ] Called out in `CHANGELOG.md` under a **Breaking** heading, naming the
      exact fields affected and how long the backward-compatible read path
      will be kept.
- [ ] If the migration can't fully preserve session state, the changelog says
      what the user-visible effect is (e.g. "existing users will be prompted
      to reconnect once").
- [ ] A tracked follow-up exists to remove the compatibility read path once
      enough time has passed, so it doesn't accumulate forever.

## Worked example

The hypothetical change: replace the flat `lastActiveAt: string` on
`WalletSession` with a structured
`activity: { lastActiveAt: string; lastActiveNetwork: Network }`, so a stored
session records which network the user was last active on.

`session-schema-migration-checklist.ts` in this folder implements it, and the
test file exercises every item in sections 1–3 above.

**1. Backward compatibility** — the guard branches on which shape it sees, and
still rejects anything that is neither:

```ts
export function isStoredSession(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!hasCoreFields(v)) return false;

  // New shape.
  if (typeof v.activity === "object" && v.activity !== null) {
    const a = v.activity as Record<string, unknown>;
    return typeof a.lastActiveAt === "string";
  }
  // Old shape — still valid, migrated below.
  return typeof v.lastActiveAt === "string";
}
```

**2. Migration helper** — pure, synchronous, idempotent, with a defined
fallback (`network`) for the field that didn't exist in old data:

```ts
export function migrateSession(stored: OldWalletSession | NewWalletSession): NewWalletSession {
  if (isCurrentShape(stored)) return stored; // already current — idempotent

  const { lastActiveAt, ...rest } = stored;
  return {
    ...rest,
    activity: { lastActiveAt, lastActiveNetwork: rest.network },
  };
}
```

The read path is validate-then-migrate, returning `null` for anything
unrecognised to match `restore()`'s fail-soft posture:

```ts
export function loadSession(raw: unknown): NewWalletSession | null {
  if (!isStoredSession(raw)) return null;
  return migrateSession(raw as OldWalletSession | NewWalletSession);
}
```

**3. Testing** — old-shape input migrates correctly with the right fallback;
new-shape input round-trips unchanged; migrating twice is stable; invalid data
returns `null`; the helper doesn't mutate its input.

**4. Rollout** — `CHANGELOG.md` notes that `lastActiveAt` is replaced by
`activity.lastActiveAt` / `activity.lastActiveNetwork`, that both shapes are
read for the next two minor versions, and links a tracking issue to drop the
old-shape read path afterwards.
