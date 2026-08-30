import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { error, info, setSilent, warn } from "./lightweight-logger";

describe("lightweight-logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setSilent(false); // reset module-level state so tests don't leak into each other
    vi.restoreAllMocks();
  });

  it("prefixes each level with a clear label", () => {
    info("hello");
    warn("careful");
    error("broken");

    expect(console.log).toHaveBeenCalledWith("[INFO] hello");
    expect(console.warn).toHaveBeenCalledWith("[WARN] careful");
    expect(console.error).toHaveBeenCalledWith("[ERROR] broken");
  });

  it("produces no output at all once silenced", () => {
    setSilent(true);

    info("hello");
    warn("careful");
    error("broken");

    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("resumes logging after silence is turned back off", () => {
    setSilent(true);
    info("swallowed");
    setSilent(false);
    info("heard");

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith("[INFO] heard");
  });
});
