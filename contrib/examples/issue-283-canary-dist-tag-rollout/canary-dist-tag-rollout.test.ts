import { describe, expect, it } from "vitest";
import {
  distTagFor,
  promoteToLatest,
  PromotionError,
  publish,
  resolveDefaultInstall,
  type RegistryState,
} from "./canary-dist-tag-rollout";

describe("distTagFor", () => {
  it("routes a prerelease tag to next", () => {
    expect(distTagFor("v0.7.0-canary.0")).toBe("next");
    expect(distTagFor("v0.7.0-canary.1")).toBe("next");
    expect(distTagFor("v1.0.0-rc.0")).toBe("next");
    expect(distTagFor("v1.0.0-beta.3")).toBe("next");
  });

  it("routes a plain release tag to latest", () => {
    expect(distTagFor("v0.7.0")).toBe("latest");
    expect(distTagFor("v1.0.0")).toBe("latest");
    expect(distTagFor("v0.6.1")).toBe("latest");
  });

  it("treats the leading v as optional", () => {
    expect(distTagFor("0.7.0-canary.0")).toBe("next");
    expect(distTagFor("0.7.0")).toBe("latest");
  });
});

describe("publish", () => {
  const released: RegistryState = { published: ["0.6.1"], distTags: { latest: "0.6.1" } };

  it("publishing a canary does NOT move latest", () => {
    const after = publish(released, "v0.7.0-canary.0");
    expect(after.distTags.next).toBe("0.7.0-canary.0");
    expect(after.distTags.latest).toBe("0.6.1");
    expect(resolveDefaultInstall(after)).toBe("0.6.1");
  });

  it("publishing a plain release moves latest", () => {
    const after = publish(released, "v0.7.0");
    expect(after.distTags.latest).toBe("0.7.0");
    expect(resolveDefaultInstall(after)).toBe("0.7.0");
  });

  it("records the version as published", () => {
    expect(publish(released, "v0.7.0-canary.0").published).toContain("0.7.0-canary.0");
  });

  it("does not mutate the input state", () => {
    publish(released, "v0.7.0-canary.0");
    expect(released.distTags).toEqual({ latest: "0.6.1" });
    expect(released.published).toEqual(["0.6.1"]);
  });

  it("a second canary replaces the first on next, still leaving latest alone", () => {
    let state = publish(released, "v0.7.0-canary.0");
    state = publish(state, "v0.7.0-canary.1");
    expect(state.distTags.next).toBe("0.7.0-canary.1");
    expect(state.distTags.latest).toBe("0.6.1");
    expect(state.published).toEqual(["0.6.1", "0.7.0-canary.0", "0.7.0-canary.1"]);
  });
});

describe("promoteToLatest", () => {
  const withCanary = publish(
    { published: ["0.6.1"], distTags: { latest: "0.6.1" } },
    "v0.7.0-canary.0",
  );

  it("moves latest onto the promoted version", () => {
    const after = promoteToLatest(withCanary, "0.7.0-canary.0");
    expect(after.distTags.latest).toBe("0.7.0-canary.0");
    expect(resolveDefaultInstall(after)).toBe("0.7.0-canary.0");
  });

  it("leaves next pointing where it was (promotion is not a republish)", () => {
    expect(promoteToLatest(withCanary, "0.7.0-canary.0").distTags.next).toBe("0.7.0-canary.0");
  });

  it("refuses a version that was never published", () => {
    expect(() => promoteToLatest(withCanary, "0.7.0-canary.99")).toThrow(PromotionError);
  });

  it("names the published versions in the refusal, so a typo is obvious", () => {
    try {
      promoteToLatest(withCanary, "0.9.9");
      expect.fail("expected a throw");
    } catch (err) {
      expect((err as Error).message).toContain("0.7.0-canary.0");
      expect((err as Error).message).toContain("not published");
    }
  });

  it("does not publish a new version — only retags an existing one", () => {
    const after = promoteToLatest(withCanary, "0.7.0-canary.0");
    expect(after.published).toEqual(withCanary.published);
  });

  it("does not mutate the input state", () => {
    promoteToLatest(withCanary, "0.7.0-canary.0");
    expect(withCanary.distTags.latest).toBe("0.6.1");
  });
});

// The requirement: exercise the full canary publish -> validate -> promote
// flow once, end to end.
describe("the full canary publish and promote flow, end to end", () => {
  it("runs the whole loop with latest only moving at the promotion step", () => {
    // 0. A released 0.6.1 is what everyone installs.
    let state: RegistryState = { published: ["0.6.1"], distTags: { latest: "0.6.1" } };
    expect(resolveDefaultInstall(state)).toBe("0.6.1");

    // 1. Cut a canary. It goes to `next`.
    state = publish(state, "v0.7.0-canary.0");
    expect(state.distTags.next).toBe("0.7.0-canary.0");

    // 2. Ordinary consumers are provably unaffected — this is the property
    //    the whole canary stage exists to guarantee.
    expect(resolveDefaultInstall(state)).toBe("0.6.1");

    // 3. A mistyped promotion fails loudly rather than silently no-op'ing.
    expect(() => promoteToLatest(state, "0.7.0-canry.0")).toThrow(PromotionError);
    expect(resolveDefaultInstall(state)).toBe("0.6.1");

    // 4. After consumer validation, promote. Now latest moves.
    state = promoteToLatest(state, "0.7.0-canary.0");
    expect(resolveDefaultInstall(state)).toBe("0.7.0-canary.0");

    // 5. The promoted artifact is the one that was validated — promotion
    //    published nothing new.
    expect(state.published).toEqual(["0.6.1", "0.7.0-canary.0"]);

    // 6. A later plain release still goes straight to latest, unchanged.
    state = publish(state, "v0.7.0");
    expect(resolveDefaultInstall(state)).toBe("0.7.0");
  });
});
