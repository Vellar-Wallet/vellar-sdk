import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createMemoryStorage,
  createSessionStore,
  type SessionRefreshResult,
  type SessionStatus,
  type WalletSession,
} from "./session-refresh";

const session: WalletSession = {
  accountId: "CA7QY3Z54G5P6H7J8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D",
  lastActiveAt: "2026-07-16T10:00:00.000Z",
};

describe("session-refresh return shape (#213)", () => {
  // --- Type-level: assert the documented shape exactly. ---
  it("documents refresh() as Promise<SessionRefreshResult>", () => {
    const store = createSessionStore(createMemoryStorage(null));
    // refresh() resolves to exactly the documented result type…
    expectTypeOf(store.refresh).returns.resolves.toEqualTypeOf<SessionRefreshResult>();
    // …whose shape is `{ session, status }`.
    expectTypeOf(store.refresh).returns.resolves.toEqualTypeOf<{
      session: WalletSession | null;
      status: SessionStatus;
    }>();
  });

  it("SessionRefreshResult exposes the documented session and status fields", () => {
    type Result = SessionRefreshResult;
    expectTypeOf<Result>().toHaveProperty("session").toEqualTypeOf<WalletSession | null>();
    expectTypeOf<Result>().toHaveProperty("status").toEqualTypeOf<SessionStatus>();
  });

  // --- Runtime: behavior matches the documented shape. ---
  it("resolves the connected shape when a valid session is persisted", async () => {
    const store = createSessionStore(createMemoryStorage(session));
    const result = await store.refresh();
    expect(result).toEqual({ session, status: "connected" });
  });

  it("resolves the disconnected shape when nothing is persisted", async () => {
    const store = createSessionStore(createMemoryStorage(null));
    const result = await store.refresh();
    expect(result).toEqual({ session: null, status: "disconnected" });
  });

  it("resolves disconnected (never rejects) when storage is unreadable", async () => {
    const store = createSessionStore({
      load: async () => {
        throw new Error("corrupt");
      },
      save: async () => {},
      clear: async () => {},
    });
    const result = await store.refresh();
    expect(result).toEqual({ session: null, status: "disconnected" });
  });

  it("resolves disconnected for malformed persisted data", async () => {
    const store = createSessionStore(createMemoryStorage({ nonsense: true } as unknown as WalletSession));
    const result = await store.refresh();
    expect(result).toEqual({ session: null, status: "disconnected" });
  });
});