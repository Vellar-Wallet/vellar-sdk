import { describe, expect, it } from "vitest";
import * as root from "./index";
import * as experimental from "./experimental-exports";
import { EXPERIMENTAL_EXPORTS, STABLE_V1_EXPORTS } from "./export-surface";

describe("public export surface", () => {
  it("exposes every documented stable v1 export at the package root", () => {
    for (const name of STABLE_V1_EXPORTS) {
      expect(root).toHaveProperty(name);
    }
  });

  it("exposes every documented experimental export on the namespace", () => {
    for (const name of EXPERIMENTAL_EXPORTS) {
      expect(experimental).toHaveProperty(name);
      expect(root.experimental).toHaveProperty(name);
    }
  });
});
