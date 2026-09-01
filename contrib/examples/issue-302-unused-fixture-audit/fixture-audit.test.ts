import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditFixtures,
  countReferences,
  formatAuditReport,
  parseFixtureExports,
  parseFixtureImports,
} from "./fixture-audit";

const MODULE_ID = "x402-test-fixtures";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("parseFixtureExports", () => {
  it("picks up both const and function exports, in declaration order", () => {
    const source = [
      "import type { Foo } from './types';",
      "export const TOKEN = 'C...';",
      "export const PAYTO = 'G...';",
      "export function b64(o: unknown): string { return ''; }",
    ].join("\n");

    expect(parseFixtureExports(source)).toEqual([
      { name: "TOKEN", kind: "const" },
      { name: "PAYTO", kind: "const" },
      { name: "b64", kind: "function" },
    ]);
  });

  it("ignores non-exported declarations and type-only exports", () => {
    const source = [
      "const INTERNAL = 1;",
      "function helper() {}",
      "export type Thing = { a: number };",
      "export interface Other { b: string }",
      "export const REAL = 2;",
    ].join("\n");

    expect(parseFixtureExports(source)).toEqual([{ name: "REAL", kind: "const" }]);
  });
});

describe("parseFixtureImports", () => {
  it("reads the named bindings off the fixture import line", () => {
    const source = [
      "import { describe, it } from 'vitest';",
      "import { TOKEN, b64, requirements } from './x402-test-fixtures';",
    ].join("\n");

    expect(parseFixtureImports(source, MODULE_ID)).toEqual(["TOKEN", "b64", "requirements"]);
  });

  it("returns the local name for aliased imports, since that is what the body uses", () => {
    const source = "import { TOKEN as ASSET, b64 } from '../src/x402-test-fixtures';";
    expect(parseFixtureImports(source, MODULE_ID)).toEqual(["ASSET", "b64"]);
  });

  it("strips inline `type` modifiers", () => {
    const source = "import { type Requirements, TOKEN } from './x402-test-fixtures';";
    expect(parseFixtureImports(source, MODULE_ID)).toEqual(["Requirements", "TOKEN"]);
  });

  it("returns nothing when the file does not import the fixture module", () => {
    const source = "import { describe, it } from 'vitest';\nconst TOKEN = 'local';";
    expect(parseFixtureImports(source, MODULE_ID)).toEqual([]);
  });

  it("is not fooled by a longer import list appearing earlier in the file", () => {
    // Regression guard: a lazy `[\s\S]*?` regex spans from the FIRST import in
    // the file to the fixture specifier, capturing every intervening binding.
    const source = [
      "import { describe, expect, it, vi } from 'vitest';",
      "import {",
      "  DisallowedAssetError,",
      "  InvalidRequirementsError,",
      "} from './x402-types';",
      "import { TOKEN, PAYTO } from './x402-test-fixtures';",
    ].join("\n");

    expect(parseFixtureImports(source, MODULE_ID)).toEqual(["TOKEN", "PAYTO"]);
  });
});

describe("countReferences", () => {
  it("does not count the fixture import line itself", () => {
    const source = ["import { TOKEN } from './x402-test-fixtures';", "const other = 1;"].join("\n");
    expect(countReferences(source, "TOKEN", MODULE_ID)).toBe(0);
  });

  it("counts real uses in the body", () => {
    const source = [
      "import { TOKEN } from './x402-test-fixtures';",
      "it('works', () => {",
      "  expect(TOKEN).toBe(TOKEN);",
      "});",
    ].join("\n");

    expect(countReferences(source, "TOKEN", MODULE_ID)).toBe(2);
  });

  it("matches whole words only, so a longer identifier does not count", () => {
    const source = ["const TOKEN_LIST = [];", "const MY_TOKEN = 1;", "use(TOKEN);"].join("\n");
    expect(countReferences(source, "TOKEN", MODULE_ID)).toBe(1);
  });
});

describe("auditFixtures", () => {
  const fixtureSource = [
    "export const USED = 'a';",
    "export const DEAD = 'b';",
    "export function helper() { return DEAD; }",
  ].join("\n");

  it("flags an export that nobody imports", () => {
    const result = auditFixtures({
      fixtureSource,
      moduleId: MODULE_ID,
      consumers: [
        {
          file: "a.test.ts",
          source: "import { USED, helper } from './x402-test-fixtures';\nuse(USED); helper();",
        },
      ],
    });

    expect(result.unusedExports).toEqual(["DEAD"]);
  });

  it("does NOT count a fixture's use inside the fixture module itself as a reference", () => {
    // `helper()` references DEAD, but that is internal to the fixture module.
    // An export used only internally still shouldn't be exported.
    const result = auditFixtures({
      fixtureSource,
      moduleId: MODULE_ID,
      consumers: [{ file: "a.test.ts", source: "import { USED } from './x402-test-fixtures';\nuse(USED);" }],
    });

    expect(result.unusedExports).toContain("DEAD");
  });

  it("treats an imported-but-unreferenced export as unused, not used", () => {
    const result = auditFixtures({
      fixtureSource,
      moduleId: MODULE_ID,
      consumers: [
        // DEAD is imported but never referenced — the exact case a bare grep
        // gets wrong.
        { file: "a.test.ts", source: "import { USED, DEAD } from './x402-test-fixtures';\nuse(USED);" },
      ],
    });

    // `helper` is unused too — no consumer imports it at all.
    expect(result.unusedExports).toEqual(["DEAD", "helper"]);
    expect(result.deadImports).toEqual([{ file: "a.test.ts", names: ["DEAD"] }]);
  });

  it("counts an export as used when ANY consumer references it", () => {
    const result = auditFixtures({
      fixtureSource,
      moduleId: MODULE_ID,
      consumers: [
        { file: "a.test.ts", source: "import { DEAD } from './x402-test-fixtures';" },
        { file: "b.test.ts", source: "import { DEAD } from './x402-test-fixtures';\nuse(DEAD);" },
      ],
    });

    expect(result.unusedExports).not.toContain("DEAD");
    // Still reported as a dead import in the file that doesn't use it.
    expect(result.deadImports).toEqual([{ file: "a.test.ts", names: ["DEAD"] }]);
  });

  it("ignores files that never import the fixture module, even if names collide", () => {
    const result = auditFixtures({
      fixtureSource,
      moduleId: MODULE_ID,
      consumers: [
        { file: "a.test.ts", source: "import { USED } from './x402-test-fixtures';\nuse(USED);" },
        // Declares its own DEAD; must not make the fixture's DEAD look used.
        { file: "unrelated.test.ts", source: "const DEAD = 'local';\nuse(DEAD); use(DEAD);" },
      ],
    });

    // The unrelated file's local `DEAD` must not rescue the fixture's `DEAD`.
    expect(result.unusedExports).toEqual(["DEAD", "helper"]);
    expect(result.consumers.map((c) => c.file)).toEqual(["a.test.ts"]);
  });

  it("sums references across consumers and records who imports what", () => {
    const result = auditFixtures({
      fixtureSource,
      moduleId: MODULE_ID,
      consumers: [
        { file: "a.test.ts", source: "import { USED } from './x402-test-fixtures';\nuse(USED); use(USED);" },
        { file: "b.test.ts", source: "import { USED } from './x402-test-fixtures';\nuse(USED);" },
      ],
    });

    const used = result.verdicts.find((v) => v.name === "USED");
    expect(used?.totalReferences).toBe(3);
    expect(used?.importedBy).toEqual(["a.test.ts", "b.test.ts"]);
  });
});

describe("formatAuditReport", () => {
  it("states that nothing can be removed when every export is used", () => {
    const report = formatAuditReport(
      auditFixtures({
        fixtureSource: "export const USED = 'a';",
        moduleId: MODULE_ID,
        consumers: [{ file: "a.test.ts", source: "import { USED } from './x402-test-fixtures';\nuse(USED);" }],
      }),
    );

    expect(report).toContain("nothing to remove");
    expect(report).toContain("| `USED` | const | 1 | a.test.ts |");
  });

  it("names the removable exports when there are any", () => {
    const report = formatAuditReport(
      auditFixtures({
        fixtureSource: "export const USED = 'a';\nexport const DEAD = 'b';",
        moduleId: MODULE_ID,
        consumers: [{ file: "a.test.ts", source: "import { USED } from './x402-test-fixtures';\nuse(USED);" }],
      }),
    );

    expect(report).toContain("Unused exports (safe to remove): `DEAD`");
  });
});

// The audit that answers issue #302 for the tree this test runs against.
describe("src/x402-test-fixtures.ts (live audit)", () => {
  const fixturePath = join(repoRoot, "src/x402-test-fixtures.ts");
  // Every file known to import the fixtures module, per a repo-wide search.
  const consumerPaths = [
    "src/x402-client.test.ts",
    "src/x402-guards.test.ts",
    "contrib/x402-client-fallback.test.ts",
    "contrib/x402-guards-boundary.test.ts",
  ];

  const result = auditFixtures({
    fixtureSource: readFileSync(fixturePath, "utf8"),
    moduleId: MODULE_ID,
    consumers: consumerPaths.map((p) => ({
      file: relative(repoRoot, join(repoRoot, p)).replace(/\\/g, "/"),
      source: readFileSync(join(repoRoot, p), "utf8"),
    })),
  });

  it("finds every consumer of the fixture module", () => {
    expect(result.consumers).toHaveLength(consumerPaths.length);
  });

  it("reports NO unused exports — the premise of #302 does not hold on this branch", () => {
    // If a future change orphans a fixture, this fails and names it, which is
    // exactly when the removal #302 asked for becomes correct.
    expect(result.unusedExports).toEqual([]);
  });

  it("confirms each individual export is referenced by at least one live test", () => {
    for (const verdict of result.verdicts) {
      expect(
        verdict.totalReferences,
        `${verdict.name} is exported but never referenced`,
      ).toBeGreaterThan(0);
    }
  });
});
