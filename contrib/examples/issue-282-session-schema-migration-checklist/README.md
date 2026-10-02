# Session schema migration checklist

Self-contained reference for issue [#282](https://github.com/Vellar-Wallet/vellar-sdk/issues/282): a standard checklist for safely rolling out a breaking change to the stored session schema across consumer versions.

**The checklist itself is in [CHECKLIST.md](CHECKLIST.md).**

## What's here

| File | What it is |
| ---- | ---------- |
| [`CHECKLIST.md`](CHECKLIST.md) | The checklist — backward compatibility, migration helper usage, testing, rollout — plus the worked example. |
| `session-schema-migration-checklist.ts` | A runnable implementation of that worked example, so the guidance is demonstrably correct rather than only asserted. |
| `session-schema-migration-checklist.test.ts` | Tests exercising every item in checklist sections 1–3. |

## Why a checklist is needed

`WalletSession` is persisted by the **consumer's app** (`localStorage`, or
their own `SessionStorageAdapter`), not by the SDK's own process. A user can
carry a session written by an older SDK for months before their app upgrades.
`restore()` in `src/session.ts` is deliberately fail-soft — unreadable storage
means "disconnected", never a crash — so an unmigrated breaking change
silently signs every existing user out on their next app load, with no error
surfaced anywhere.

## Referencing it in a migration PR

A PR that breaks the session schema should link the checklist and check the
boxes (or mark one N/A with a reason):

```
Migration checklist: contrib/examples/issue-282-session-schema-migration-checklist/CHECKLIST.md
```

## The worked example

Replacing the flat `lastActiveAt: string` with a structured
`activity: { lastActiveAt, lastActiveNetwork }`. The guard accepts both
shapes, a pure and idempotent `migrateSession` upgrades old data on read with
a defined fallback for the field that didn't exist before, and invalid data is
still rejected.

## Run it

```sh
npx tsx session-schema-migration-checklist.ts
```

## Tests

```sh
npx vitest run contrib/examples/issue-282-session-schema-migration-checklist
```
