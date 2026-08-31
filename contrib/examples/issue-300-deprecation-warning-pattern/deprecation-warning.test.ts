import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetWarnOnceForTests, legacySend, warnOnce } from "./deprecation-warning";

describe("warnOnce", () => {
  beforeEach(() => {
    _resetWarnOnceForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the message the first time a given id fires", () => {
    warnOnce("example-id", "this is a deprecation notice");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith("this is a deprecation notice");
  });

  it("does not log again for the same id on a second call", () => {
    warnOnce("example-id", "first message");
    warnOnce("example-id", "first message");
    warnOnce("example-id", "first message");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("tracks separate ids independently", () => {
    warnOnce("id-a", "message a");
    warnOnce("id-b", "message b");
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe("legacySend deprecation warning", () => {
  beforeEach(() => {
    _resetWarnOnceForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires a deprecation warning on first call", () => {
    legacySend("GDEST111", 100n);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("legacySend() is deprecated"));
  });

  it("does not repeat the warning on subsequent calls in the same process", () => {
    legacySend("GDEST111", 100n);
    legacySend("GDEST222", 200n);
    legacySend("GDEST333", 300n);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("still returns the correct result despite the warning", () => {
    const result = legacySend("GDEST111", 100n);
    expect(result).toEqual({ to: "GDEST111", amount: 100n });
  });
});
