import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditLockfile,
  licenseAllowed,
  matchingException,
} from "./check-licenses.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function lock(packages: Record<string, unknown>) {
  return { packages };
}

describe("license expressions", () => {
  it("allows permissive SPDX ids and conjunctions of them", () => {
    expect(licenseAllowed("MIT")).toBe(true);
    expect(licenseAllowed("Apache-2.0")).toBe(true);
    expect(licenseAllowed("(MIT AND BSD-3-Clause)")).toBe(true);
    expect(licenseAllowed("MIT OR Apache-2.0")).toBe(true);
    expect(licenseAllowed("Apache-2.0 WITH LLVM-exception")).toBe(true);
  });

  it("rejects copyleft, including a dual license whose only free option is copyleft", () => {
    expect(licenseAllowed("AGPL-3.0-or-later")).toBe(false);
    expect(licenseAllowed("GPL-3.0-only")).toBe(false);
    expect(licenseAllowed("LGPL-3.0-or-later")).toBe(false);
    expect(licenseAllowed("(GPL-3.0-only AND MIT)")).toBe(false);
  });

  it("accepts an OR expression when one side is allowlisted", () => {
    expect(licenseAllowed("GPL-3.0-only OR MIT")).toBe(true);
  });
});

describe("auditLockfile", () => {
  const permissive = {
    "": {
      name: "vellar-sdk",
      license: "Apache-2.0",
      dependencies: { left: "1.0.0" },
      devDependencies: { right: "1.0.0" },
    },
    "packages/cli": { name: "vellar-cli", license: "Apache-2.0", dependencies: { left: "1.0.0" } },
    "packages/mcp-x402-payer": {
      name: "vellar-mcp-x402-payer",
      license: "Apache-2.0",
      dependencies: {},
    },
    "node_modules/left": { license: "MIT", dependencies: { nested: "1.0.0" } },
    "node_modules/left/node_modules/nested": { license: "ISC" },
    "node_modules/right": { license: "BSD-3-Clause" },
  };

  it("passes a tree of allowlisted licenses across the root and both workspaces", () => {
    expect(auditLockfile(lock(permissive)).ok).toBe(true);
  });

  it("fails when a new transitive dependency is copyleft", () => {
    const packages = {
      ...permissive,
      "node_modules/left/node_modules/nested": { license: "GPL-3.0-only" },
    };
    const result = auditLockfile(lock(packages));
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({ name: "nested", license: "GPL-3.0-only" }),
    ]);
  });

  it("fails when a package declares no license and has no dated exception", () => {
    const packages = {
      ...permissive,
      "node_modules/right": {},
    };
    const result = auditLockfile(lock(packages));
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.name)).toContain("right");
  });

  it("allows the issue 516 AGPL package only, and still fails a different AGPL package", () => {
    expect(matchingException("@openzeppelin/relayer-sdk", "AGPL-3.0-or-later")?.issue).toBe(516);
    expect(matchingException("@openzeppelin/relayer-sdk", "AGPL-3.0-or-later")?.dated).toBe(
      "2026-09-30",
    );

    function withDep(name: string, license: string) {
      return lock({
        ...permissive,
        "node_modules/left": { license: "MIT", dependencies: { [name]: "1.0.0" } },
        [`node_modules/${name}`]: { license },
      });
    }

    expect(auditLockfile(withDep("@openzeppelin/relayer-sdk", "AGPL-3.0-or-later")).ok).toBe(true);

    const other = auditLockfile(withDep("some-other-agpl", "AGPL-3.0-or-later"));
    expect(other.ok).toBe(false);
    expect(other.violations.map((v) => v.name)).toContain("some-other-agpl");

    const changed = auditLockfile(withDep("@openzeppelin/relayer-sdk", "GPL-3.0-only"));
    expect(changed.ok).toBe(false);
    expect(changed.violations.map((v) => v.name)).toContain("@openzeppelin/relayer-sdk");
  });

  it("does not walk devDependencies of transitive packages", () => {
    const packages = {
      ...permissive,
      "node_modules/left": {
        license: "MIT",
        devDependencies: { "only-a-devdep": "1.0.0" },
      },
      "node_modules/only-a-devdep": { license: "GPL-3.0-only" },
    };
    expect(auditLockfile(lock(packages)).ok).toBe(true);
  });
});

describe("the repository lockfile", () => {
  it("passes, including the dated AGPL exception", () => {
    const real = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
    const result = auditLockfile(real);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
