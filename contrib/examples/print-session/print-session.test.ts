import { describe, expect, it, vi } from "vitest";
import { printSession, type WalletSession } from "./print-session";

describe("printSession", () => {
  it("labels and prints every field, including a value", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const session: WalletSession = {
      accountId: "CFULL",
      network: "mainnet",
      connected: true,
      authMethod: "passkey",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: "2026-01-02T00:00:00.000Z",
      serverSessionId: "sess_1",
      keyId: "key_1",
    };
    printSession(session);

    const lines = spy.mock.calls.map((call) => call.join(" "));
    expect(lines.some((l) => l.includes("Account ID:") && l.includes("CFULL"))).toBe(true);
    expect(lines.some((l) => l.includes("Server session ID:") && l.includes("sess_1"))).toBe(true);
    expect(lines.some((l) => l.includes("Key ID:") && l.includes("key_1"))).toBe(true);
    spy.mockRestore();
  });

  it("falls back to (none) for optional fields when absent", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const session: WalletSession = {
      accountId: "CMIN",
      network: "testnet",
      connected: false,
      authMethod: "passkey",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastActiveAt: "2026-01-01T00:00:00.000Z",
    };
    printSession(session);

    const lines = spy.mock.calls.map((call) => call.join(" "));
    expect(lines.some((l) => l.includes("Server session ID:") && l.includes("(none)"))).toBe(true);
    expect(lines.some((l) => l.includes("Key ID:") && l.includes("(none)"))).toBe(true);
    spy.mockRestore();
  });
});
