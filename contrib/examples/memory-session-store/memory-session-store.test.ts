import { describe, expect, it } from "vitest";
import { getSession, setSession, type WalletSession } from "./memory-session-store";

const sample: WalletSession = {
  accountId: "CTEST",
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastActiveAt: "2026-01-01T00:00:00.000Z",
};

describe("memory session store", () => {
  it("returns null before any session is set", () => {
    expect(getSession()).toBeNull();
  });

  it("returns the session that was set", () => {
    setSession(sample);
    expect(getSession()).toEqual(sample);
  });

  it("overwrites the previous session on a second setSession call", () => {
    setSession(sample);
    const updated = { ...sample, accountId: "CTEST2" };
    setSession(updated);
    expect(getSession()).toEqual(updated);
  });
});
