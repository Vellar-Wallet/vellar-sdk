import { describe, expect, it } from "vitest";
import * as root from "./index";
import * as experimental from "./experimental-exports";
import * as policyFacade from "./policy-facade";
import * as x402Facade from "./x402-facade";
import * as react from "./react";
import {
  EXPERIMENTAL_EXPORTS,
  STABLE_V1_EXPORTS,
} from "./export-surface";

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

  it("keeps facade exports on disjoint stable and experimental paths", () => {
    const intendedNames = [...STABLE_V1_EXPORTS, ...EXPERIMENTAL_EXPORTS];
    expect(new Set(intendedNames).size).toBe(intendedNames.length);
    expect(STABLE_V1_EXPORTS).toContain("createPolicyFacade");
    expect(EXPERIMENTAL_EXPORTS).toContain("createX402Facade");
    expect(root.createPolicyFacade).toBe(policyFacade.createPolicyFacade);
    expect(root.createX402Facade).toBe(x402Facade.createX402Facade);
    expect(root).not.toHaveProperty("VellarProvider");
    expect(root).not.toHaveProperty("useWallet");
    expect(react).toHaveProperty("VellarProvider");
    expect(react).toHaveProperty("useWallet");
  });
});
