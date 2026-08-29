import { describe, expect, it } from "vitest";
import { distTagFor } from "./npm-dist-tag-for.mjs";

describe("distTagFor", () => {
  it("publishes a prerelease tag to next", () => {
    expect(distTagFor("v0.7.0-canary.0")).toBe("next");
    expect(distTagFor("v0.7.0-canary.1")).toBe("next");
    expect(distTagFor("v1.0.0-rc.0")).toBe("next");
    expect(distTagFor("v1.0.0-beta.3")).toBe("next");
  });

  it("publishes a plain release tag to latest", () => {
    expect(distTagFor("v0.7.0")).toBe("latest");
    expect(distTagFor("v1.0.0")).toBe("latest");
    expect(distTagFor("v0.6.1")).toBe("latest");
  });

  it("strips the leading v before checking for a prerelease suffix", () => {
    expect(distTagFor("0.7.0-canary.0")).toBe("next");
    expect(distTagFor("0.7.0")).toBe("latest");
  });
});
