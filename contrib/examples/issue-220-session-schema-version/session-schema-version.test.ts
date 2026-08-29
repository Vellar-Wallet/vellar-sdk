import { describe, expect, it } from "vitest";
import {
  loadSession,
  saveSession,
  SESSION_SCHEMA_VERSION,
  unwrapSession,
  wrapSession,
  type WalletSession,
} from "./session-schema-version";

const session: WalletSession = {
  accountId: "CACCOUNT123",
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-07-16T10:00:00.000Z",
  lastActiveAt: "2026-07-16T10:00:00.000Z",
};

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe("session schema version", () => {
  it("wraps writes with schemaVersion", () => {
    const wrapped = wrapSession(session);
    expect(wrapped.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(wrapped.session).toEqual(session);
  });

  it("round-trips a versioned session through storage", () => {
    const storage = fakeStorage();
    saveSession(storage, "vellar.session", session);
    const raw = JSON.parse(storage.map.get("vellar.session")!);
    expect(raw.schemaVersion).toBe(1);
    expect(loadSession(storage, "vellar.session")).toEqual(session);
  });

  it("rejects unversioned legacy cache entries", () => {
    expect(unwrapSession(session)).toBeNull();
  });

  it("rejects mismatched schemaVersion", () => {
    expect(unwrapSession({ schemaVersion: 999, session })).toBeNull();
  });

  it("loadSession returns null for legacy persisted sessions", () => {
    const storage = fakeStorage();
    storage.setItem("vellar.session", JSON.stringify(session));
    expect(loadSession(storage, "vellar.session")).toBeNull();
  });
});
