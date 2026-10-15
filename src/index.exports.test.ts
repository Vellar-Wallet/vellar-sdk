import { describe, expect, it, vi } from "vitest";

vi.mock("./x402-signer", () => ({
  createSessionKeySigner: vi.fn(),
  createPasskeyX402Signer: vi.fn(),
}));

import * as root from "./index";
import * as experimental from "./experimental-exports";
import * as policyFacade from "./policy-facade";
import * as x402Facade from "./x402-facade";
import { EXPERIMENTAL_EXPORTS, FACADE_EXPORTS, STABLE_V1_EXPORTS } from "./export-surface";

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

  it("matches the consolidated runtime facade export list", () => {
    const facadeModuleNames = new Set([...Object.keys(policyFacade), ...Object.keys(x402Facade)]);
    const rootFacadeNames = Object.keys(root)
      .filter((name) => facadeModuleNames.has(name))
      .sort();

    expect(rootFacadeNames).toEqual([...FACADE_EXPORTS].sort());
  });
});
