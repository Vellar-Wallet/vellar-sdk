// Self-contained reference for issue #282: a checklist for safely rolling out
// a BREAKING change to the stored session schema, backed by a runnable worked
// example of the migration pattern the checklist prescribes.
//
// See CHECKLIST.md in this folder for the checklist itself. This file is the
// executable half: it implements the hypothetical schema change the checklist
// walks through, so the guidance is demonstrably correct rather than only
// asserted.
//
// THE HYPOTHETICAL CHANGE: replace the flat `lastActiveAt: string` field on
// WalletSession with a structured `activity: { lastActiveAt, lastActiveNetwork }`,
// so a stored session records which network the user was last active on.
//
// WHY THIS NEEDS A MIGRATION: WalletSession is persisted by the CONSUMER's app
// (localStorage, or their own SessionStorageAdapter), not by the SDK's own
// process. A user can carry a session written by an older SDK for months
// before their app upgrades. src/session.ts's restore() is deliberately
// fail-soft — unreadable storage means "disconnected", never a crash — so an
// unmigrated breaking change silently signs every existing user out on their
// next app load, with no error surfaced anywhere.
//
// Run with: npx tsx session-schema-migration-checklist.ts

export type Network = "testnet" | "mainnet";

/** The session shape as stored by the PREVIOUS release. */
export interface OldWalletSession {
  accountId: string;
  network: Network;
  connected: boolean;
  authMethod: "passkey";
  createdAt: string;
  lastActiveAt: string;
}

/** The session shape after the hypothetical breaking change. */
export interface NewWalletSession {
  accountId: string;
  network: Network;
  connected: boolean;
  authMethod: "passkey";
  createdAt: string;
  activity: {
    lastActiveAt: string;
    lastActiveNetwork: Network;
  };
}

/** Fields common to both shapes — what the guard can check before branching. */
function hasCoreFields(v: Record<string, unknown>): boolean {
  return (
    typeof v.accountId === "string" &&
    v.accountId.length > 0 &&
    (v.network === "testnet" || v.network === "mainnet") &&
    typeof v.connected === "boolean" &&
    v.authMethod === "passkey" &&
    typeof v.createdAt === "string"
  );
}

/**
 * CHECKLIST ITEM 1 (backward compatibility): the guard accepts BOTH shapes.
 *
 * A session written by the previous release must still be recognised, or
 * restore() drops it and the user is silently signed out. Genuinely invalid
 * data must still be rejected — the guard is loosened to accept one extra
 * known shape, not loosened into accepting anything.
 */
export function isStoredSession(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!hasCoreFields(v)) return false;

  // New shape.
  if (typeof v.activity === "object" && v.activity !== null) {
    const a = v.activity as Record<string, unknown>;
    return typeof a.lastActiveAt === "string";
  }
  // Old shape — still valid, migrated by migrateSession below.
  return typeof v.lastActiveAt === "string";
}

/** True when `value` is already in the current (new) shape. */
export function isCurrentShape(value: unknown): value is NewWalletSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.activity === "object" && v.activity !== null;
}

/**
 * CHECKLIST ITEM 2 (migration helper): upgrade an old-shape session in memory.
 *
 * Properties the checklist requires of this function, all exercised by the
 * tests in this folder:
 *
 *  - PURE and SYNCHRONOUS — no network, no passkey prompt. A migration that
 *    needs either is a sign the change needs a softer rollout, not a bigger
 *    migration function.
 *  - IDEMPOTENT — running it on an already-current session returns it
 *    unchanged, so repeated restore() calls and future chained migrations
 *    stay safe.
 *  - DEFINED FALLBACK for the new field — `lastActiveNetwork` did not exist
 *    in old data, so it falls back to the session's own `network`, the best
 *    available evidence, rather than being left undefined for downstream
 *    code to trip over.
 */
export function migrateSession(stored: OldWalletSession | NewWalletSession): NewWalletSession {
  if (isCurrentShape(stored)) return stored; // already current — idempotent

  const { lastActiveAt, ...rest } = stored;
  return {
    ...rest,
    activity: {
      lastActiveAt,
      lastActiveNetwork: rest.network,
    },
  };
}

/**
 * The read path a consumer's storage adapter / restore() would use:
 * validate, then migrate. Returns `null` for anything unrecognised, matching
 * src/session.ts's fail-soft posture.
 *
 * CHECKLIST ITEM 2 also requires the migration run on READ, not write — a
 * consumer should never have to run an explicit "migrate my users" step.
 */
export function loadSession(raw: unknown): NewWalletSession | null {
  if (!isStoredSession(raw)) return null;
  return migrateSession(raw as OldWalletSession | NewWalletSession);
}

function main() {
  const oldSession: OldWalletSession = {
    accountId: "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW",
    network: "testnet",
    connected: true,
    authMethod: "passkey",
    createdAt: "2026-07-16T10:00:00.000Z",
    lastActiveAt: "2026-07-16T10:30:00.000Z",
  };

  const migrated = loadSession(oldSession);
  console.log("old shape  -> migrated:", JSON.stringify(migrated?.activity));

  // Idempotent: migrating the result again changes nothing.
  const twice = loadSession(migrated);
  console.log("migrated twice equal  :", JSON.stringify(twice) === JSON.stringify(migrated));

  // A session already in the new shape round-trips untouched.
  console.log("new shape passthrough :", JSON.stringify(loadSession(migrated)?.activity));

  // Garbage is still rejected — the guard was widened, not disabled.
  console.log("garbage rejected      :", loadSession({ nope: true }) === null);
  console.log("null rejected         :", loadSession(null) === null);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
