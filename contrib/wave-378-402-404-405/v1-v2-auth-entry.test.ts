import { describe, it, expect } from "vitest";
import { assertAuthEntryInvocationV1V2, AuthEntryMismatchError } from "./v1-v2-auth-entry";

describe("v1-v2-auth-entry tests (#378)", () => {
  it("exports assertion function", () => {
    expect(typeof assertAuthEntryInvocationV1V2).toBe("function");
    expect(AuthEntryMismatchError).toBeDefined();
  });
});
