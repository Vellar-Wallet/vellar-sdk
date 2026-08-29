/**
 * session-change-emitter.test.ts
 *
 * Tests for the session change emitter.
 *
 * Run from the repo root:
 *   npx vitest run contrib/examples/issue-64-session-change-emitter/session-change-emitter.test.ts
 *
 * Or run the whole suite:
 *   npm test
 */

import { describe, it, expect, vi } from "vitest";
import { createSessionEmitter } from "./session-change-emitter";

describe("createSessionEmitter", () => {
  it("initial session is null", () => {
    const emitter = createSessionEmitter();
    expect(emitter.getSession()).toBeNull();
  });

  it("subscriber receives the new session value", () => {
    const emitter = createSessionEmitter();
    const handler = vi.fn();

    emitter.subscribe(handler);
    emitter.setSession({ userId: "abc", token: "tok-1" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ userId: "abc", token: "tok-1" }, null);
  });

  it("subscriber receives the previous session as the second argument", () => {
    const emitter = createSessionEmitter();
    const handler = vi.fn();

    emitter.subscribe(handler);
    emitter.setSession({ userId: "first" });
    emitter.setSession({ userId: "second" });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, { userId: "first" }, null);
    expect(handler).toHaveBeenNthCalledWith(2, { userId: "second" }, { userId: "first" });
  });

  it("multiple subscribers all receive the same update", () => {
    const emitter = createSessionEmitter();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const handlerC = vi.fn();

    emitter.subscribe(handlerA);
    emitter.subscribe(handlerB);
    emitter.subscribe(handlerC);

    const session = { userId: "multi" };
    emitter.setSession(session);

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
    expect(handlerC).toHaveBeenCalledOnce();

    expect(handlerA).toHaveBeenCalledWith(session, null);
    expect(handlerB).toHaveBeenCalledWith(session, null);
    expect(handlerC).toHaveBeenCalledWith(session, null);
  });

  it("unsubscribe stops the handler from receiving further updates", () => {
    const emitter = createSessionEmitter();
    const handler = vi.fn();

    const unsubscribe = emitter.subscribe(handler);

    emitter.setSession({ userId: "before" });
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();

    emitter.setSession({ userId: "after" });
    // still only one call — the second update was not delivered
    expect(handler).toHaveBeenCalledOnce();
  });

  it("unsubscribing one subscriber does not affect others", () => {
    const emitter = createSessionEmitter();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    const unsubA = emitter.subscribe(handlerA);
    emitter.subscribe(handlerB);

    unsubA();

    emitter.setSession({ userId: "only-b" });

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledOnce();
  });

  it("setSession with null clears the session", () => {
    const emitter = createSessionEmitter();

    emitter.setSession({ userId: "temp" });
    emitter.setSession(null);

    expect(emitter.getSession()).toBeNull();
  });

  it("getSession reflects the latest value without triggering notifications", () => {
    const emitter = createSessionEmitter();
    const handler = vi.fn();

    emitter.subscribe(handler);
    emitter.setSession({ userId: "alice" });

    // getSession should not fire handlers
    const session = emitter.getSession();

    expect(session).toEqual({ userId: "alice" });
    expect(handler).toHaveBeenCalledOnce(); // only from setSession, not getSession
  });
});
