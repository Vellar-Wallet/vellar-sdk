import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkX402Versions,
  collectX402Specifiers,
  readPackageJson,
  resolveMajor,
  resolveWorkspaceDirs,
} from "./check-x402-versions.mjs";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");

// ── resolveMajor ─────────────────────────────────────────────────────────────

describe("resolveMajor", () => {
  it("parses an exact pin", () => {
    expect(resolveMajor("2.22.0")).toBe(2);
  });

  it("parses a caret range", () => {
    expect(resolveMajor("^2.16.0")).toBe(2);
  });

  it("parses a tilde range", () => {
    expect(resolveMajor("~3.1.0")).toBe(3);
  });

  it("parses a >=range", () => {
    expect(resolveMajor(">=2.0.0")).toBe(2);
  });

  it("parses a major.x pattern", () => {
    expect(resolveMajor("2.x")).toBe(2);
  });

  it("returns null for a wildcard specifier", () => {
    expect(resolveMajor("*")).toBeNull();
  });

  it("returns null for a workspace: specifier", () => {
    expect(resolveMajor("workspace:*")).toBeNull();
  });

  it("returns null for a file: specifier", () => {
    expect(resolveMajor("file:../core")).toBeNull();
  });

  it("returns null for an https: specifier", () => {
    expect(resolveMajor("https://example.com/pkg.tgz")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveMajor("")).toBeNull();
  });

  it("returns null for a non-string", () => {
    // @ts-expect-error intentional bad input for robustness test
    expect(resolveMajor(null)).toBeNull();
  });
});

// ── readPackageJson ───────────────────────────────────────────────────────────

describe("readPackageJson", () => {
  it("reads the happy-path root fixture", () => {
    const pkg = readPackageJson(path.join(fixturesDir, "happy-path", "package.json"));
    expect(pkg).not.toBeNull();
    expect(pkg?.name).toBe("fixture-happy-path");
  });

  it("returns null for a non-existent path", () => {
    expect(readPackageJson(path.join(fixturesDir, "does-not-exist", "package.json"))).toBeNull();
  });
});

// ── collectX402Specifiers ─────────────────────────────────────────────────────

describe("collectX402Specifiers", () => {
  it("collects from dependencies", () => {
    const pkg = { dependencies: { "@x402/core": "2.22.0", "@x402/stellar": "^2.16.0" } };
    const result = collectX402Specifiers(pkg);
    expect(result.get("@x402/core")).toBe("2.22.0");
    expect(result.get("@x402/stellar")).toBe("^2.16.0");
  });

  it("collects from devDependencies", () => {
    const pkg = { devDependencies: { "@x402/core": "2.22.0" } };
    expect(collectX402Specifiers(pkg).get("@x402/core")).toBe("2.22.0");
  });

  it("prefers dependencies over devDependencies when both declare the same package", () => {
    const pkg = {
      dependencies: { "@x402/core": "2.22.0" },
      devDependencies: { "@x402/core": "3.0.0" },
    };
    expect(collectX402Specifiers(pkg).get("@x402/core")).toBe("2.22.0");
  });

  it("returns an empty map when no x402 packages are present", () => {
    expect(collectX402Specifiers({ dependencies: { zustand: "^5.0.0" } }).size).toBe(0);
  });

  it("returns an empty map for a package with no deps at all", () => {
    expect(collectX402Specifiers({}).size).toBe(0);
  });
});

// ── resolveWorkspaceDirs ──────────────────────────────────────────────────────

describe("resolveWorkspaceDirs", () => {
  it("expands a glob pattern into sub-directories", () => {
    const dirs = resolveWorkspaceDirs(path.join(fixturesDir, "happy-path"), ["packages/*"]);
    expect(dirs.length).toBe(2);
    expect(dirs.some((d) => d.endsWith("pkg-a"))).toBe(true);
    expect(dirs.some((d) => d.endsWith("pkg-b"))).toBe(true);
  });

  it("returns an empty array for a missing parent directory", () => {
    expect(resolveWorkspaceDirs("/does-not-exist", ["packages/*"])).toEqual([]);
  });

  it("handles a literal (non-glob) workspace path", () => {
    const dirs = resolveWorkspaceDirs(path.join(fixturesDir, "happy-path"), ["packages/pkg-a"]);
    expect(dirs.length).toBe(1);
    expect(dirs[0]).toContain("pkg-a");
  });
});

// ── checkX402Versions — happy path ───────────────────────────────────────────

describe("checkX402Versions — happy path", () => {
  it("passes when all workspaces pin the same major version", () => {
    // pkg-a: 2.22.0, pkg-b: ^2.16.0 — both resolve to major 2
    const result = checkX402Versions(path.join(fixturesDir, "happy-path"));
    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it("includes an entry for every declared x402 specifier", () => {
    const result = checkX402Versions(path.join(fixturesDir, "happy-path"));
    // pkg-a: @x402/core + @x402/stellar; pkg-b: @x402/core + @x402/stellar → 4 entries
    expect(result.entries).toHaveLength(4);
  });

  it("passes when no workspace declares x402 at all", () => {
    const result = checkX402Versions(path.join(fixturesDir, "no-x402"));
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });
});

// ── checkX402Versions — failure modes ────────────────────────────────────────

describe("checkX402Versions — @x402/core major mismatch", () => {
  // Deliberately drifted fixture: pkg-a pins 2.22.0, pkg-b bumps to ^3.0.0.
  // This is exactly the scenario described in issue #618.
  it("fails and reports the conflict", () => {
    const result = checkX402Versions(path.join(fixturesDir, "mismatch-core"));
    expect(result.ok).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].package).toBe("@x402/core");
  });

  it("identifies both conflicting majors", () => {
    const { conflicts } = checkX402Versions(path.join(fixturesDir, "mismatch-core"));
    expect(conflicts[0].majors.has(2)).toBe(true);
    expect(conflicts[0].majors.has(3)).toBe(true);
  });

  it("names the packages responsible in the conflict report", () => {
    const { conflicts } = checkX402Versions(path.join(fixturesDir, "mismatch-core"));
    const locs = [...conflicts[0].majors.values()].flat().join(" ");
    expect(locs).toContain("fixture-mismatch-core-pkg-a");
    expect(locs).toContain("fixture-mismatch-core-pkg-b");
  });
});

describe("checkX402Versions — @x402/stellar major mismatch", () => {
  // pkg-a: @x402/stellar 2.22.0, pkg-b: @x402/stellar ^3.0.0
  it("fails and reports exactly the stellar conflict", () => {
    const result = checkX402Versions(path.join(fixturesDir, "mismatch-stellar"));
    expect(result.ok).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].package).toBe("@x402/stellar");
  });
});

describe("checkX402Versions — both packages mismatched", () => {
  // pkg-a: core@2 + stellar@2; pkg-b: core@3 + stellar@3
  it("fails and reports two conflicts", () => {
    const result = checkX402Versions(path.join(fixturesDir, "mismatch-both"));
    expect(result.ok).toBe(false);
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts.map((c) => c.package).sort()).toEqual(["@x402/core", "@x402/stellar"]);
  });
});

// ── checkX402Versions — real workspace smoke-check ───────────────────────────

describe("checkX402Versions — real vellar-sdk workspace", () => {
  // The live repo must always pass. If someone bumps an @x402/* version in one
  // package without updating the rest, this test fails CI immediately.
  it("passes on the current repository", () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const result = checkX402Versions(repoRoot);
    expect(result.ok).toBe(true);
  });
});
