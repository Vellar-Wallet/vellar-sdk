import { describe, expect, it } from "vitest";
import type { WalletSession } from "../../../src/types";
import {
  detectSchemaVersion,
  dryRunMigration,
  KNOWN_SCHEMA_VERSIONS,
  loadAndMigrateSession,
  migrateStorage,
  migrateStoredSession,
  SESSION_SCHEMA_VERSION,
  wrapSession,
  type SessionStorageLike,
} from "./session-schema-migration";

const session: WalletSession = {
  accountId: "CACCOUNT123",
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-07-16T10:00:00.000Z",
  lastActiveAt: "2026-07-16T10:30:00.000Z",
};

const fixedNow = () => new Date("2026-08-28T12:00:00.000Z");

/** v0: the bare pre-envelope shape written by SDK <= 0.5.x. */
const v0 = session;
/** v1: the envelope introduced by issue #220. */
const v1 = { schemaVersion: 1, session };
/** v2: current. */
const v2 = { schemaVersion: 2, session };

function fakeStorage(initial?: Record<string, string>): SessionStorageLike & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("detectSchemaVersion", () => {
  it("detects the bare v0 session shape", () => {
    expect(detectSchemaVersion(v0)).toBe(0);
  });

  it("detects the v1 envelope", () => {
    expect(detectSchemaVersion(v1)).toBe(1);
  });

  it("detects the current v2 envelope", () => {
    expect(detectSchemaVersion(v2)).toBe(2);
  });

  it("returns null for a version newer than this SDK knows", () => {
    expect(detectSchemaVersion({ schemaVersion: 99, session })).toBeNull();
  });

  it("returns null for an envelope wrapping an invalid session", () => {
    expect(detectSchemaVersion({ schemaVersion: 1, session: { accountId: "" } })).toBeNull();
  });

  it.each([null, undefined, 42, "string", [], {}])("returns null for %o", (value) => {
    expect(detectSchemaVersion(value)).toBeNull();
  });
});

describe("migrateStoredSession — upgrade from each known prior version", () => {
  it("upgrades v0 (bare session) to the current envelope", () => {
    const result = migrateStoredSession(v0, { now: fixedNow });
    expect(result.outcome).toBe("migrated");
    expect(result.from).toBe(0);
    expect(result.to).toBe(SESSION_SCHEMA_VERSION);
    expect(result.needsMigration).toBe(true);
    expect(result.envelope).toEqual({
      schemaVersion: SESSION_SCHEMA_VERSION,
      session,
      migratedAt: "2026-08-28T12:00:00.000Z",
    });
  });

  it("upgrades v1 (issue #220 envelope) to the current envelope", () => {
    const result = migrateStoredSession(v1, { now: fixedNow });
    expect(result.outcome).toBe("migrated");
    expect(result.from).toBe(1);
    expect(result.envelope?.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(result.envelope?.session).toEqual(session);
    expect(result.envelope?.migratedAt).toBe("2026-08-28T12:00:00.000Z");
  });

  it("covers every known prior version", () => {
    const priors = KNOWN_SCHEMA_VERSIONS.filter((v) => v !== SESSION_SCHEMA_VERSION);
    const blobs: Record<number, unknown> = { 0: v0, 1: v1 };
    expect(priors).toEqual([0, 1]);
    for (const version of priors) {
      const result = migrateStoredSession(blobs[version], { now: fixedNow });
      expect(result.from).toBe(version);
      expect(result.outcome).toBe("migrated");
      expect(result.envelope?.session).toEqual(session);
    }
  });

  it("reports an already-current envelope as up-to-date", () => {
    const result = migrateStoredSession(v2);
    expect(result.outcome).toBe("up-to-date");
    expect(result.needsMigration).toBe(false);
    expect(result.envelope).toEqual(v2);
  });

  it("preserves optional fields through the upgrade", () => {
    const rich: WalletSession = { ...session, serverSessionId: "srv-1", keyId: "key-1" };
    const result = migrateStoredSession(rich, { now: fixedNow });
    expect(result.envelope?.session.serverSessionId).toBe("srv-1");
    expect(result.envelope?.session.keyId).toBe("key-1");
  });

  it("omits absent optional fields rather than writing undefined", () => {
    const result = migrateStoredSession(v0, { now: fixedNow });
    expect(Object.keys(result.envelope!.session)).not.toContain("serverSessionId");
    expect(Object.keys(result.envelope!.session)).not.toContain("keyId");
  });

  it("drops unknown keys carried by an old blob", () => {
    const legacy = { ...session, legacyToken: "should-not-survive" };
    const result = migrateStoredSession(legacy, { now: fixedNow });
    expect(result.envelope!.session).not.toHaveProperty("legacyToken");
  });

  it("reports unsupported input without throwing", () => {
    const result = migrateStoredSession({ schemaVersion: 99, session });
    expect(result.outcome).toBe("unsupported");
    expect(result.envelope).toBeNull();
    expect(result.needsMigration).toBe(false);
    expect(result.from).toBeNull();
  });
});

describe("dry-run mode", () => {
  it("reports that migration is needed without producing an envelope", () => {
    const report = dryRunMigration(v0);
    expect(report.needsMigration).toBe(true);
    expect(report.from).toBe(0);
    expect(report.to).toBe(SESSION_SCHEMA_VERSION);
    expect(report).not.toHaveProperty("envelope");
  });

  it("reports no migration needed for a current envelope", () => {
    expect(dryRunMigration(v2).needsMigration).toBe(false);
    expect(dryRunMigration(v2).outcome).toBe("up-to-date");
  });

  it("reports unsupported blobs as not needing migration", () => {
    expect(dryRunMigration("garbage").outcome).toBe("unsupported");
    expect(dryRunMigration("garbage").needsMigration).toBe(false);
  });

  it("leaves storage untouched", () => {
    const storage = fakeStorage({ "vellar.session": JSON.stringify(v0) });
    const before = storage.map.get("vellar.session");
    const result = migrateStorage(storage, "vellar.session", { dryRun: true });
    expect(result.needsMigration).toBe(true);
    expect(storage.map.get("vellar.session")).toBe(before);
  });
});

describe("migrateStorage", () => {
  it("writes the upgraded envelope back to storage", () => {
    const storage = fakeStorage({ "vellar.session": JSON.stringify(v0) });
    const result = migrateStorage(storage, "vellar.session", { now: fixedNow });
    expect(result.outcome).toBe("migrated");
    expect(JSON.parse(storage.map.get("vellar.session")!)).toEqual({
      schemaVersion: SESSION_SCHEMA_VERSION,
      session,
      migratedAt: "2026-08-28T12:00:00.000Z",
    });
  });

  it("is idempotent — a second run reports up-to-date and rewrites nothing", () => {
    const storage = fakeStorage({ "vellar.session": JSON.stringify(v0) });
    migrateStorage(storage, "vellar.session", { now: fixedNow });
    const after = storage.map.get("vellar.session");
    const second = migrateStorage(storage, "vellar.session", { now: fixedNow });
    expect(second.outcome).toBe("up-to-date");
    expect(storage.map.get("vellar.session")).toBe(after);
  });

  it("reports a missing key without writing", () => {
    const storage = fakeStorage();
    const result = migrateStorage(storage, "vellar.session");
    expect(result.outcome).toBe("unsupported");
    expect(result.needsMigration).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it("reports malformed JSON instead of throwing", () => {
    const storage = fakeStorage({ "vellar.session": "{not json" });
    const result = migrateStorage(storage, "vellar.session");
    expect(result.outcome).toBe("unsupported");
    expect(result.reason).toContain("not valid JSON");
  });

  it("clears an unsupported blob only when asked", () => {
    const kept = fakeStorage({ "vellar.session": "{not json" });
    migrateStorage(kept, "vellar.session");
    expect(kept.map.has("vellar.session")).toBe(true);

    const cleared = fakeStorage({ "vellar.session": "{not json" });
    migrateStorage(cleared, "vellar.session", { clearUnsupported: true });
    expect(cleared.map.has("vellar.session")).toBe(false);
  });

  it("does not clear during a dry run", () => {
    const storage = fakeStorage({ "vellar.session": "{not json" });
    migrateStorage(storage, "vellar.session", { clearUnsupported: true, dryRun: true });
    expect(storage.map.has("vellar.session")).toBe(true);
  });
});

describe("loadAndMigrateSession", () => {
  it("returns the session for a legacy v0 blob, where the v1 loader returned null", () => {
    const storage = fakeStorage({ "vellar.session": JSON.stringify(v0) });
    expect(loadAndMigrateSession(storage, "vellar.session", { now: fixedNow })).toEqual(session);
    expect(JSON.parse(storage.map.get("vellar.session")!).schemaVersion).toBe(
      SESSION_SCHEMA_VERSION,
    );
  });

  it("returns the session in dry-run mode without upgrading storage", () => {
    const storage = fakeStorage({ "vellar.session": JSON.stringify(v0) });
    expect(loadAndMigrateSession(storage, "vellar.session", { dryRun: true })).toEqual(session);
    expect(JSON.parse(storage.map.get("vellar.session")!)).toEqual(v0);
  });

  it("returns null for an unsupported blob", () => {
    const storage = fakeStorage({ "vellar.session": JSON.stringify({ schemaVersion: 99 }) });
    expect(loadAndMigrateSession(storage, "vellar.session")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(loadAndMigrateSession(fakeStorage(), "vellar.session")).toBeNull();
  });
});

describe("wrapSession", () => {
  it("writes fresh sessions at the current version with no migration stamp", () => {
    const wrapped = wrapSession(session);
    expect(wrapped.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(wrapped.migratedAt).toBeUndefined();
    expect(migrateStoredSession(wrapped).outcome).toBe("up-to-date");
  });
});
