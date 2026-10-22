import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The page is authored here and lands in website/content/docs/architecture/.
// Links are resolved from that destination, so a broken link fails now rather
// than after the page is moved.
const DEST_DIR = path.resolve(__dirname, "../../website/content/docs/architecture");
const md = readFileSync(path.join(__dirname, "policies-vs-multisig.md"), "utf8");

describe("policies-vs-multisig page", () => {
  it("has a title and the required comparison sections", () => {
    expect(md.startsWith("# ")).toBe(true);
    for (const heading of ["Threshold semantics", "Revocation speed", "Composability with agent keys", "Decision guide"]) {
      expect(md).toContain(`## ${heading}`);
    }
  });

  it("references the real PolicyDefinition and agent-keys API", () => {
    expect(md).toContain("`PolicyDefinition`");
    expect(md).toContain("`threshold`");
    expect(md).toContain("wallet.agents.revoke");
    expect(md).toContain("{ token, policies }");
  });

  it("resolves every relative .md link from its destination folder", () => {
    const links = [...md.matchAll(/\]\((\.{1,2}\/[^)#\s]+\.md)(?:#[^)]*)?\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(existsSync(path.resolve(DEST_DIR, link)), link).toBe(true);
    }
  });
});
