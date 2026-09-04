import { describe, expect, it } from "vitest";
import {
  isCurrentShape,
  isStoredSession,
  loadSession,
  migrateSession,
  type NewWalletSession,
  type OldWalletSession,
} from "./session-schema-migration-checklist";

const ACCOUNT = "CAFIATCEAZJTGQQKFL3N2YB6VMCUN2UYX4QD5A3FALDRU7UJJ6OWBKOW";

const oldSession: OldWalletSession = {
  accountId: ACCOUNT,
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-07-16T10:00:00.000Z",
  lastActiveAt: "2026-07-16T10:30:00.000Z",
};

const newSession: NewWalletSession = {
  accountId: ACCOUNT,
  network: "mainnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-07-16T10:00:00.000Z",
  activity: {
    lastActiveAt: "2026-07-16T10:30:00.000Z",
    lastActiveNetwork: "mainnet",
  },
};

// Checklist item 1: backward compatibility.
describe("isStoredSession accepts both shapes (backward compatibility)", () => {
  it("accepts a session in the OLD shape", () => {
    expect(isStoredSession(oldSession)).toBe(true);
  });

  it("accepts a session in the NEW shape", () => {
    expect(isStoredSession(newSession)).toBe(true);
  });

  it("still rejects genuinely invalid data", () => {
    expect(isStoredSession(null)).toBe(false);
    expect(isStoredSession(undefined)).toBe(false);
    expect(isStoredSession("a string")).toBe(false);
    expect(isStoredSession({})).toBe(false);
    expect(isStoredSession({ nope: true })).toBe(false);
  });

  it("rejects a session missing a core field", () => {
    const { accountId: _omitted, ...missingAccount } = oldSession;
    expect(isStoredSession(missingAccount)).toBe(false);
  });

  it("rejects a session with an invalid network", () => {
    expect(isStoredSession({ ...oldSession, network: "devnet" })).toBe(false);
  });

  it("rejects a session carrying neither lastActiveAt nor activity", () => {
    const { lastActiveAt: _omitted, ...neither } = oldSession;
    expect(isStoredSession(neither)).toBe(false);
  });
});

// Checklist item 2: migration helper usage.
describe("migrateSession upgrades old data on read", () => {
  it("moves lastActiveAt into the structured activity field", () => {
    const migrated = migrateSession(oldSession);
    expect(migrated.activity.lastActiveAt).toBe("2026-07-16T10:30:00.000Z");
  });

  it("falls back to the session's own network for the new lastActiveNetwork field", () => {
    expect(migrateSession(oldSession).activity.lastActiveNetwork).toBe("testnet");
    expect(migrateSession({ ...oldSession, network: "mainnet" }).activity.lastActiveNetwork).toBe(
      "mainnet",
    );
  });

  it("preserves every other field unchanged", () => {
    const migrated = migrateSession(oldSession);
    expect(migrated.accountId).toBe(oldSession.accountId);
    expect(migrated.network).toBe(oldSession.network);
    expect(migrated.connected).toBe(oldSession.connected);
    expect(migrated.authMethod).toBe(oldSession.authMethod);
    expect(migrated.createdAt).toBe(oldSession.createdAt);
  });

  it("drops the superseded flat lastActiveAt field", () => {
    expect("lastActiveAt" in migrateSession(oldSession)).toBe(false);
  });

  it("is idempotent — migrating an already-current session changes nothing", () => {
    const once = migrateSession(oldSession);
    const twice = migrateSession(once);
    expect(twice).toEqual(once);
  });

  it("returns an already-current session as-is", () => {
    expect(migrateSession(newSession)).toBe(newSession);
  });

  it("is pure — it does not mutate its input", () => {
    const input: OldWalletSession = { ...oldSession };
    migrateSession(input);
    expect(input.lastActiveAt).toBe("2026-07-16T10:30:00.000Z");
    expect("activity" in input).toBe(false);
  });
});

describe("isCurrentShape", () => {
  it("distinguishes the new shape from the old", () => {
    expect(isCurrentShape(newSession)).toBe(true);
    expect(isCurrentShape(oldSession)).toBe(false);
  });
});

// Checklist item 3: the tests a migration PR is required to carry.
describe("loadSession: the read path restore() would use", () => {
  it("accepts old-shape data and returns it migrated", () => {
    const loaded = loadSession(oldSession);
    expect(loaded).not.toBeNull();
    expect(loaded!.activity).toEqual({
      lastActiveAt: "2026-07-16T10:30:00.000Z",
      lastActiveNetwork: "testnet",
    });
  });

  it("round-trips new-shape data unchanged (no double-application)", () => {
    expect(loadSession(newSession)).toEqual(newSession);
  });

  it("returns null for invalid data rather than throwing", () => {
    expect(loadSession({ nope: true })).toBeNull();
    expect(loadSession(null)).toBeNull();
    expect(loadSession("garbage")).toBeNull();
  });

  it("a migrated session re-loaded stays stable", () => {
    const once = loadSession(oldSession);
    expect(loadSession(once)).toEqual(once);
  });
});
