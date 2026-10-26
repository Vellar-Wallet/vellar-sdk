// Tests for the SRI hash generator (#669). Uses a temp fixture directory
// standing in for dist/, so these never depend on `npm run build` having
// run, matching the vitest.alias.ts philosophy (no build-order
// dependency between tests and the build they're testing).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSriHashes, computeSriHashes } from "./generate-sri-hashes.mjs";

let fixtureDir: string;

afterEach(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

function makeFixture(files: Record<string, string>): string {
  fixtureDir = mkdtempSync(join(tmpdir(), "vellar-sri-test-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(fixtureDir, name), content);
  }
  return fixtureDir;
}

describe("computeSriHashes", () => {
  it("hashes every file in the directory with sha384", () => {
    const dir = makeFixture({ "index.js": "export const x = 1;\n" });
    const hashes = computeSriHashes(dir);

    expect(Object.keys(hashes)).toEqual(["index.js"]);
    expect(hashes["index.js"]).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
  });

  it("produces the same hash for the same content, deterministically", () => {
    const dir = makeFixture({ "a.js": "same content" });
    const first = computeSriHashes(dir);
    const second = computeSriHashes(dir);

    expect(first).toEqual(second);
  });

  it("produces a different hash when content changes", () => {
    const dirA = makeFixture({ "a.js": "version one" });
    const hashA = computeSriHashes(dirA);
    rmSync(dirA, { recursive: true, force: true });

    const dirB = makeFixture({ "a.js": "version two" });
    const hashB = computeSriHashes(dirB);

    expect(hashA["a.js"]).not.toBe(hashB["a.js"]);
  });

  it("excludes sri-hashes.json itself from the hashed set", () => {
    const dir = makeFixture({
      "index.js": "export const x = 1;\n",
      "sri-hashes.json": "{}",
    });
    const hashes = computeSriHashes(dir);

    expect(Object.keys(hashes)).toEqual(["index.js"]);
  });

  it("hashes files inside subdirectories", () => {
    const dir = makeFixture({});
    writeFileSync(join(dir, "nested-placeholder.js"), "placeholder");
    mkdirSync(join(dir, "chunks"));
    writeFileSync(join(dir, "chunks", "shared.js"), "shared code");

    const hashes = computeSriHashes(dir);

    expect(Object.keys(hashes).sort()).toEqual(
      ["nested-placeholder.js", join("chunks", "shared.js")].sort(),
    );
  });
});

describe("checkSriHashes", () => {
  it("passes when sri-hashes.json matches the freshly computed hashes", () => {
    const dir = makeFixture({ "index.js": "export const x = 1;\n" });
    const hashes = computeSriHashes(dir);
    writeFileSync(join(dir, "sri-hashes.json"), JSON.stringify(hashes));

    expect(checkSriHashes(dir)).toEqual({ ok: true });
  });

  it("fails when a file's content changed after the recorded hashes were generated", () => {
    const dir = makeFixture({ "index.js": "original" });
    const hashes = computeSriHashes(dir);
    writeFileSync(join(dir, "sri-hashes.json"), JSON.stringify(hashes));

    // Simulate a rebuild that changed the output without regenerating hashes.
    writeFileSync(join(dir, "index.js"), "rebuilt, different content");

    const result = checkSriHashes(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("hash mismatch");
  });

  it("fails when a file is added to dist/ without updating the recorded hashes", () => {
    const dir = makeFixture({ "index.js": "content" });
    const hashes = computeSriHashes(dir);
    writeFileSync(join(dir, "sri-hashes.json"), JSON.stringify(hashes));

    writeFileSync(join(dir, "new-chunk.js"), "a new file the build emitted");

    const result = checkSriHashes(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("file list mismatch");
  });

  it("fails with a clear reason when sri-hashes.json is missing entirely", () => {
    const dir = makeFixture({ "index.js": "content" });

    const result = checkSriHashes(dir);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("could not read");
  });
});
