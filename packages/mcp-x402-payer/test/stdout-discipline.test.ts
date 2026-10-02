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

  it.each(files)("%s does not write to process.stdout outside the sanctioned places", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));

    // output.ts owns the diversion helper; server.ts's startStdio must capture
    // the real sink before diverting, or the diversion swallows the JSON-RPC
    // stream itself (security audit V-4). Both are bounded exemptions: the rest
    // of each file must still be clean.
    if (file.endsWith("output.ts")) return;
    if (file.endsWith("server.ts")) {
      const start = code.indexOf("export async function startStdio");
      expect(start, "startStdio not found — exemption may be stale").toBeGreaterThan(-1);
      const outside = code.slice(0, start);
      expect(outside).not.toMatch(/process\s*\.\s*stdout/);
      return;
    }
    expect(code).not.toMatch(/process\s*\.\s*stdout/);
  });

  it("output.ts logs to stderr, and touches stdout ONLY to divert it", () => {
    const code = stripComments(readFileSync(join(SRC, "output.ts"), "utf8"));
    expect(code).toMatch(/process\.stderr\.write/);

    // `divertStdoutToStderr` must override process.stdout — that is its whole
    // job (security audit V-4). Every OTHER mention would be a logging path.
    const divert = code.slice(code.indexOf("export function divertStdoutToStderr"));
    const elsewhere = code.replace(divert, "");
    expect(elsewhere).not.toMatch(/process\s*\.\s*stdout/);
  });

  it("bin.ts reports startup failures on stderr", () => {
    const code = stripComments(readFileSync(join(SRC, "bin.ts"), "utf8"));
    expect(code).toMatch(/process\.stderr\.write/);
  });
});

describe("V-4 — a dependency writing to stdout cannot corrupt the transport", () => {
  it("diverts stray stdout writes to stderr", async () => {
    const { divertStdoutToStderr } = await import("../src/output.js");
    let out = "";
    let err = "";
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: unknown) => ((out += String(c)), true)) as never;
    process.stderr.write = ((c: unknown) => ((err += String(c)), true)) as never;

    const restore = divertStdoutToStderr();
    // vitest intercepts `console.log`, so call the sink it ultimately reaches —
    // which is what @x402/core's unguarded console.log lands on in production.
    process.stdout.write("[x402] extension responses: {}\n");
    restore();

    process.stdout.write = realOut;
    process.stderr.write = realErr;

    expect(out, "a dependency's console.log reached stdout").toBe("");
    expect(err).toContain("[diverted-stdout]");
    expect(err).toContain("[x402] extension responses");
  });

  it("invokes the write callback so a caller awaiting it cannot hang", async () => {
    const { divertStdoutToStderr } = await import("../src/output.js");
    const realErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as never;
    const restore = divertStdoutToStderr();

    const called = await new Promise<boolean>((resolve) => {
      process.stdout.write("x", () => resolve(true));
      setTimeout(() => resolve(false), 50);
    });

    restore();
    process.stderr.write = realErr;
    expect(called).toBe(true);
  });
});
