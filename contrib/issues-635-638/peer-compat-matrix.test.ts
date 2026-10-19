import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const pkg = JSON.parse(read("../../package.json"));
const workflow = read("./peer-compat-matrix.yml");

describe("peer compat matrix workflow (#635, #636)", () => {
  it("covers every required peer at floor and latest", () => {
    expect(workflow).toContain('peer: ["@stellar/stellar-sdk", "passkey-kit"]');
    expect(workflow).toContain("bound: [floor, latest]");
  });

  it("only matrixes peers that package.json actually declares", () => {
    for (const name of ["@stellar/stellar-sdk", "passkey-kit"]) {
      expect(pkg.peerDependencies[name]).toBeTruthy();
    }
  });

  it("resolves versions from package.json instead of hardcoding them", () => {
    expect(workflow).toContain("resolve-compat-versions.mjs");
    expect(workflow).not.toMatch(/stellar-sdk@\d/);
    expect(workflow).not.toMatch(/passkey-kit@\d/);
  });

  it("runs the full suite and the passkey-kit connector suite on each leg", () => {
    expect(workflow).toContain("run: npm test");
    expect(workflow).toContain("src/passkeykit-connector.test.ts");
  });

  it("does not stop sibling legs when one fails", () => {
    expect(workflow).toContain("fail-fast: false");
  });
});
