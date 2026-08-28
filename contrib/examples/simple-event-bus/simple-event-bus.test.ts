import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./simple-event-bus";

interface TestEvents {
  ping: { n: number };
  quiet: undefined;
}

describe("EventBus", () => {
  it("delivers an emitted event to a single registered listener", () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();
    bus.on("ping", listener);

    bus.emit("ping", { n: 1 });

    expect(listener).toHaveBeenCalledExactlyOnceWith({ n: 1 });
  });

  it("delivers an emitted event to multiple registered listeners", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("ping", a);
    bus.on("ping", b);

    bus.emit("ping", { n: 42 });

    expect(a).toHaveBeenCalledExactlyOnceWith({ n: 42 });
    expect(b).toHaveBeenCalledExactlyOnceWith({ n: 42 });
  });

  it("off removes only the specific listener passed, others stay registered", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("ping", a);
    bus.on("ping", b);

    bus.off("ping", a);
    bus.emit("ping", { n: 1 });

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledExactlyOnceWith({ n: 1 });
  });

  it("does not throw emitting an event with no listeners registered", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit("quiet", undefined)).not.toThrow();
  });

  it("does not throw calling off for a listener that was never registered", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.off("ping", vi.fn())).not.toThrow();
  });

  it("keeps events independent — emitting one does not trigger listeners on another", () => {
    const bus = new EventBus<TestEvents>();
    const pingListener = vi.fn();
    const quietListener = vi.fn();
    bus.on("ping", pingListener);
    bus.on("quiet", quietListener);

    bus.emit("ping", { n: 1 });

    expect(pingListener).toHaveBeenCalledTimes(1);
    expect(quietListener).not.toHaveBeenCalled();
  });

  it("registering the same listener function twice for one event only invokes it once", () => {
    // A Set-backed listener registry naturally dedupes the same function
    // reference registered twice, rather than firing it multiple times.
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();
    bus.on("ping", listener);
    bus.on("ping", listener);

    bus.emit("ping", { n: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
