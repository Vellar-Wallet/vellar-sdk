import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSession, saveSession, type WalletSession } from "./session-file-store";

const sample: WalletSession = {
  accountId: "CTEST",
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastActiveAt: "2026-01-01T00:00:00.000Z",
};

describe("session file store", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vellar-session-store-test-"));
    filePath = join(dir, "session.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the file does not exist", async () => {
    await expect(loadSession(filePath)).resolves.toBeNull();
  });

  it("loads back exactly what was saved", async () => {
    await saveSession(filePath, sample);
    await expect(loadSession(filePath)).resolves.toEqual(sample);
  });

  it("overwrites the file on a second save", async () => {
    await saveSession(filePath, sample);
    const updated = { ...sample, accountId: "CTEST2" };
    await saveSession(filePath, updated);
    await expect(loadSession(filePath)).resolves.toEqual(updated);
  });
});
