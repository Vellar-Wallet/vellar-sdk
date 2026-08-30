import { describe, expect, it } from "vitest";
import { validateChangeset } from "../scripts/validate-changeset.mjs";

describe("validateChangeset", () => {
  it("returns valid if skip label is present", () => {
    const result = validateChangeset({
      changedFiles: ["src/client.ts"],
      labels: ["skip-changeset"],
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("Skip label present");
  });

  it("returns valid if no-changeset label is present", () => {
    const result = validateChangeset({
      changedFiles: ["src/client.ts"],
      labels: ["no-changeset"],
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("Skip label present");
  });

  it("returns valid if no source files are changed", () => {
    const result = validateChangeset({
      changedFiles: ["README.md", "website/content/docs/facilitator.md"],
      labels: [],
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("No source files changed");
  });

  it("returns invalid if source files changed but no changeset is added", () => {
    const result = validateChangeset({
      changedFiles: ["src/client.ts", "package.json"],
      labels: [],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("no changeset entry");
  });

  it("returns valid if source files changed and a changeset is added", () => {
    const result = validateChangeset({
      changedFiles: ["src/client.ts", ".changeset/funny-slug.md"],
      labels: [],
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toContain("Changeset present");
  });
});
