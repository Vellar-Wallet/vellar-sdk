/**
 * Static audit of a shared test-fixture module: which exports are actually
 * consumed, and which imports are dead.
 *
 * Contributed for issue #302, which asked to remove "several fixtures that are
 * no longer referenced by any current test file" from
 * `src/x402-test-fixtures.ts`. The first requirement on that issue is to
 * *confirm* each fixture has no remaining references — this module is that
 * confirmation step, written so the answer is reproducible instead of a
 * one-off grep that nobody can re-run later.
 *
 * Running it against the current tree is what makes the audit trustworthy:
 * every export in `src/x402-test-fixtures.ts` is still referenced by a live
 * test, so there is nothing to delete (see this example's README for the
 * evidence table). The tool is kept because "is this fixture still used?" is a
 * recurring question, and because a naive grep answers it wrongly.
 *
 * Why not just grep:
 *
 *   1. A bare `grep -c NAME` counts the import line itself, so a fixture that
 *      is imported and never used still looks used.
 *   2. It also counts unrelated local declarations that happen to share the
 *      name — `PAYTO` is defined independently in three other test files, so
 *      grep reports references that have nothing to do with the fixture.
 *   3. It cannot see the difference between an export nobody imports (delete
 *      the export) and an import nobody uses (delete the import).
 *
 * This module resolves all three by reading the import statement of each
 * consumer, then counting references in that consumer's body with the fixture
 * import line excluded.
 *
 * Deliberately dependency-free (no TypeScript compiler API, no AST library):
 * fixture modules are plain `export const` / `export function` declarations and
 * are imported with simple named-import statements, so line-oriented parsing is
 * sufficient and keeps the example self-contained. See "Limits" in the README
 * for the syntax this does not attempt to handle.
 */

/** A named export declared by the fixture module. */
export interface FixtureExport {
  name: string;
  /** `const` for values, `function` for helpers. */
  kind: "const" | "function";
}

/** One consumer's use of the fixture module. */
export interface ConsumerUsage {
  /** Path of the importing file, as given to the audit. */
  file: string;
  /** Names pulled in by that file's fixture import statement. */
  imported: string[];
  /** Imported names with zero references in the body — dead imports. */
  unusedImports: string[];
  /** Reference count per imported name, excluding the import line. */
  references: Record<string, number>;
}

/** The verdict for a single fixture export. */
export interface FixtureVerdict {
  name: string;
  kind: "const" | "function";
  /** Total references across every consumer, excluding import lines. */
  totalReferences: number;
  /** Consumers that import it (whether or not they use it). */
  importedBy: string[];
  /**
   * True when no consumer imports it, or every consumer that imports it never
   * references it. These are the exports that are safe to delete.
   */
  unused: boolean;
}

export interface AuditInput {
  /** Source of the fixture module (e.g. `src/x402-test-fixtures.ts`). */
  fixtureSource: string;
  /**
   * Every file that might import the fixture module. Files that don't import
   * it are ignored, so it is safe to pass the whole test suite.
   */
  consumers: Array<{ file: string; source: string }>;
  /**
   * Substring identifying the fixture module in an import specifier — e.g.
   * `"x402-test-fixtures"`. Matched against the whole import line, so it works
   * for both `./x402-test-fixtures` and `../src/x402-test-fixtures`.
   */
  moduleId: string;
}

export interface AuditResult {
  exports: FixtureExport[];
  consumers: ConsumerUsage[];
  verdicts: FixtureVerdict[];
  /** Exports safe to delete — none, for the current tree. */
  unusedExports: string[];
  /** Imports safe to delete, as `file` -> names. */
  deadImports: Array<{ file: string; names: string[] }>;
}

const EXPORT_DECL = /^\s*export\s+(const|function)\s+([A-Za-z_$][\w$]*)/;

/** Parse the `export const` / `export function` declarations of a fixture module. */
export function parseFixtureExports(source: string): FixtureExport[] {
  const found: FixtureExport[] = [];
  const seen = new Set<string>();
  for (const line of source.split("\n")) {
    const m = EXPORT_DECL.exec(line);
    if (!m) continue;
    const [, kind, name] = m;
    // A re-declaration can't happen in valid TS, but guard anyway so a
    // malformed file produces a clean list rather than duplicates.
    if (seen.has(name)) continue;
    seen.add(name);
    found.push({ name, kind: kind as "const" | "function" });
  }
  return found;
}

/**
 * Extract the named bindings of the import statement that pulls in `moduleId`.
 * Returns `[]` when the file doesn't import the module at all.
 *
 * Handles the single-line named-import form these fixtures use, including
 * `as` aliases (the *local* name is what the body references, so that is what
 * gets counted) and `type` modifiers.
 */
export function parseFixtureImports(source: string, moduleId: string): string[] {
  const line = source.split("\n").find((l) => l.includes(moduleId) && /^\s*import\b/.test(l));
  if (!line) return [];
  const braces = /{([^}]*)}/.exec(line);
  if (!braces) return [];
  return braces[1]
    .split(",")
    .map((part) => {
      const cleaned = part.trim().replace(/^type\s+/, "");
      if (!cleaned) return "";
      // `X as Y` — the body refers to Y.
      const alias = /\s+as\s+/.test(cleaned) ? cleaned.split(/\s+as\s+/)[1] : cleaned;
      return alias.trim();
    })
    .filter(Boolean);
}

/**
 * Count whole-word references to `name` in `source`, ignoring any line that
 * imports the fixture module. Excluding that line is the whole point: it is
 * what separates "imported and used" from merely "imported".
 */
export function countReferences(source: string, name: string, moduleId: string): number {
  const body = source
    .split("\n")
    .filter((l) => !(l.includes(moduleId) && /^\s*import\b/.test(l)))
    .join("\n");
  // Escape regex metacharacters; identifiers shouldn't contain them, but a
  // caller may pass an arbitrary string.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (body.match(new RegExp(`\\b${escaped}\\b`, "g")) ?? []).length;
}

/**
 * Audit a fixture module against its consumers.
 *
 * An export counts as used when at least one consumer imports it AND
 * references it outside the import line. Anything else is reported as unused
 * and is safe to delete.
 */
export function auditFixtures(input: AuditInput): AuditResult {
  const { fixtureSource, consumers, moduleId } = input;
  const exports = parseFixtureExports(fixtureSource);
  const exportNames = new Set(exports.map((e) => e.name));

  const usage: ConsumerUsage[] = [];
  for (const { file, source } of consumers) {
    const imported = parseFixtureImports(source, moduleId);
    if (imported.length === 0) continue; // not a consumer

    const references: Record<string, number> = {};
    const unusedImports: string[] = [];
    for (const name of imported) {
      const count = countReferences(source, name, moduleId);
      references[name] = count;
      if (count === 0) unusedImports.push(name);
    }
    usage.push({ file, imported, unusedImports, references });
  }

  const verdicts: FixtureVerdict[] = exports.map(({ name, kind }) => {
    const importedBy = usage.filter((u) => u.imported.includes(name)).map((u) => u.file);
    const totalReferences = usage.reduce((sum, u) => sum + (u.references[name] ?? 0), 0);
    return { name, kind, totalReferences, importedBy, unused: totalReferences === 0 };
  });

  return {
    exports,
    consumers: usage,
    verdicts,
    unusedExports: verdicts.filter((v) => v.unused).map((v) => v.name),
    deadImports: usage
      // Only report dead imports of names this fixture module actually exports.
      .map((u) => ({ file: u.file, names: u.unusedImports.filter((n) => exportNames.has(n)) }))
      .filter((d) => d.names.length > 0),
  };
}

/** Render an audit as a Markdown table plus a verdict line, for a PR or CI log. */
export function formatAuditReport(result: AuditResult): string {
  const lines: string[] = [
    "| Export | Kind | References | Used by |",
    "| --- | --- | ---: | --- |",
  ];
  for (const v of result.verdicts) {
    const users = v.importedBy.length > 0 ? v.importedBy.join(", ") : "—";
    lines.push(`| \`${v.name}\` | ${v.kind} | ${v.totalReferences} | ${users} |`);
  }

  lines.push("");
  lines.push(
    result.unusedExports.length === 0
      ? `All ${result.verdicts.length} exports are referenced by at least one consumer — nothing to remove.`
      : `Unused exports (safe to remove): ${result.unusedExports.map((n) => `\`${n}\``).join(", ")}`,
  );

  for (const dead of result.deadImports) {
    lines.push(`Dead imports in ${dead.file}: ${dead.names.map((n) => `\`${n}\``).join(", ")}`);
  }

  return lines.join("\n");
}
