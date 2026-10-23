/**
 * REFERENCE TEST IMPLEMENTATION for issue #686.
 * Copy/adapt into scripts/api-surface-diff.test.ts.
 */

import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs reference implementation, not typed.
import { extractExportSurface, diffExportSurfaces } from "./api-surface-diff.mjs";

const SAMPLE_BEFORE = `
export { a as parseAmount, b as NETWORKS } from './chunk.js';
export declare function createPayer(config: unknown): unknown;
export declare const DEFAULT_URL: string;
export declare class SmartAccountX402Signer {
}
export interface PaymentRequirements {
}
export type Network = "mainnet" | "testnet";
`;

describe("extractExportSurface (#686)", () => {
  it("extracts renamed re-exports by their exported (post-'as') name", () => {
    const surface = extractExportSurface(SAMPLE_BEFORE);
    expect(surface.has("parseAmount")).toBe(true);
    expect(surface.has("NETWORKS")).toBe(true);
    expect(surface.has("a")).toBe(false);
  });

  it("extracts declared functions, consts, classes, interfaces, and type aliases", () => {
    const surface = extractExportSurface(SAMPLE_BEFORE);
    expect(surface.get("createPayer")).toContain("function");
    expect(surface.get("DEFAULT_URL")).toContain("const");
    expect(surface.get("SmartAccountX402Signer")).toBe("class");
    expect(surface.get("PaymentRequirements")).toBe("interface");
    expect(surface.get("Network")).toBe("type");
  });
});

describe("diffExportSurfaces (#686)", () => {
  it("reports no changes when both surfaces are identical", () => {
    const before = extractExportSurface(SAMPLE_BEFORE);
    const after = extractExportSurface(SAMPLE_BEFORE);
    const diff = diffExportSurfaces(before, after);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged.length).toBeGreaterThan(0);
  });

  it("reports an added export that appears only in the after surface", () => {
    const before = extractExportSurface(SAMPLE_BEFORE);
    const after = extractExportSurface(
      SAMPLE_BEFORE + "export declare function brandNewFn(): void;",
    );
    const diff = diffExportSurfaces(before, after);

    expect(diff.added.map((e) => e.name)).toContain("brandNewFn");
  });

  it("reports a removed export that only appears in the before surface", () => {
    const before = extractExportSurface(SAMPLE_BEFORE);
    const after = extractExportSurface(
      SAMPLE_BEFORE.replace("export declare const DEFAULT_URL: string;\n", ""),
    );
    const diff = diffExportSurfaces(before, after);

    expect(diff.removed.map((e) => e.name)).toContain("DEFAULT_URL");
  });

  it("reports a changed export when a declared function's signature differs", () => {
    const before = extractExportSurface(SAMPLE_BEFORE);
    const after = extractExportSurface(
      SAMPLE_BEFORE.replace(
        "export declare function createPayer(config: unknown): unknown;",
        "export declare function createPayer(config: unknown, extra: string): unknown;",
      ),
    );
    const diff = diffExportSurfaces(before, after);

    expect(diff.changed.map((e) => e.name)).toContain("createPayer");
  });

  it("never reports a re-export as changed, only added or removed, since its real signature is hidden in a bundled chunk", () => {
    const before = extractExportSurface("export { a as foo } from './chunk-old.js';");
    const after = extractExportSurface("export { b as foo } from './chunk-new.js';");
    const diff = diffExportSurfaces(before, after);

    expect(diff.changed.map((e) => e.name)).not.toContain("foo");
    expect(diff.unchanged).toContain("foo");
  });
});
