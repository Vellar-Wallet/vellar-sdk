import { describe, expect, it } from "vitest";
import { getDocPage } from "./mock-docs-lookup";

describe("getDocPage", () => {
  it("returns the page for a known slug", () => {
    expect(getDocPage("passkeys")).toEqual({ slug: "passkeys", title: "Passkeys & Smart Accounts" });
  });

  it("returns undefined for an unknown slug rather than throwing", () => {
    expect(getDocPage("does-not-exist")).toBeUndefined();
  });

  it("has at least three sample pages", () => {
    expect(getDocPage("getting-started")).toBeDefined();
    expect(getDocPage("passkeys")).toBeDefined();
    expect(getDocPage("x402-payments")).toBeDefined();
  });
});
