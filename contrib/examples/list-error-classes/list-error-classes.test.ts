import { describe, expect, it } from "vitest";
import { SDK_ERROR_CLASSES } from "./list-error-classes";

describe("SDK_ERROR_CLASSES", () => {
  it("lists at least 6 error classes", () => {
    expect(SDK_ERROR_CLASSES.length).toBeGreaterThanOrEqual(6);
  });

  it("gives every entry a non-empty name and description", () => {
    for (const entry of SDK_ERROR_CLASSES) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("every name ends in Error, matching the SDK's class naming convention", () => {
    for (const entry of SDK_ERROR_CLASSES) {
      expect(entry.name.endsWith("Error")).toBe(true);
    }
  });

  it("has no duplicate class names", () => {
    const names = SDK_ERROR_CLASSES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
