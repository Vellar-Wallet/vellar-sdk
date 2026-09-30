import { afterEach, beforeEach, vi } from "vitest";

// These examples exercise a mocked PasskeyKit. Give their mock wallet calls a
// browser-shaped context without installing or invoking real WebAuthn APIs.
beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { credentials: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
