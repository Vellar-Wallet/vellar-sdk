// stdout belongs to the MCP JSON-RPC transport.
//
// A single stray write desynchronises the protocol stream, and the agent sees a
// transport error rather than whatever actually went wrong. `src/output.ts` is
// the only sanctioned writer and it targets stderr.
//
// This is a TEST rather than a lint rule because the repo has no eslint — an
// uninstalled linter enforces nothing, whereas this runs on every `npm test`.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** Strip comments so prose mentioning `console.log` doesn't trip the check. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("stdout discipline", () => {
  const files = sourceFiles(SRC);

  it("finds the source files it is meant to police", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s does not call console.*", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    expect(code).not.toMatch(/\bconsole\s*\./);
  });

  it.each(files)("%s does not write to process.stdout outside output.ts", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    if (file.endsWith("output.ts")) return; // the sanctioned writer — and it uses stderr
    expect(code).not.toMatch(/process\s*\.\s*stdout/);
  });

  it("output.ts writes to stderr, never stdout", () => {
    const code = stripComments(readFileSync(join(SRC, "output.ts"), "utf8"));
    expect(code).toMatch(/process\.stderr\.write/);
    expect(code).not.toMatch(/process\s*\.\s*stdout/);
  });

  it("bin.ts reports startup failures on stderr", () => {
    const code = stripComments(readFileSync(join(SRC, "bin.ts"), "utf8"));
    expect(code).toMatch(/process\.stderr\.write/);
  });
});
