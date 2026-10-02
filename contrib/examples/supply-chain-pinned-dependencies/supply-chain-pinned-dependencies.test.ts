import { describe, it, expect } from "vitest";
import { assertExactDependencyVersions } from "./supply-chain-pinned-dependencies";

describe("Issue #258 — Supply-Chain Pinned Dependencies", () => {
  it("detects unpinned dependencies and accepts exact pinned versions", () => {
    expect(assertExactDependencyVersions({ tsup: "8.5.1", vitest: "3.2.0" }).valid).toBe(true);

    const check = assertExactDependencyVersions({ tsup: "^8.5.1", vitest: "~3.2.0" });
    expect(check.valid).toBe(false);
    expect(check.unpinned).toHaveLength(2);
  });
});
