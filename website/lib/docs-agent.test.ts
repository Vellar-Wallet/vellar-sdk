import { describe, expect, it } from "vitest";
import { readDocSource } from "./docs";
import {
  buildLlmsFull,
  buildLlmsIndex,
  getAgentMarkdown,
  pagePreamble,
  rewriteLinksAbsolute,
  SITE_URL,
  toAgentMarkdown,
} from "./docs-agent";
import { DOC_PAGES, type DocPage } from "./docs-registry";

const page = (over: Partial<DocPage> = {}): DocPage => ({
  slug: "x402",
  title: "x402 Agentic Payments",
  nav: "x402",
  section: "x402 Payments",
  description: "Pay HTTP-402 resources.",
  ...over,
});

describe("rewriteLinksAbsolute", () => {
  it("rewrites relative .md links to absolute site URLs", () => {
    expect(rewriteLinksAbsolute("see [Policies](./policies.md) for more")).toBe(
      `see [Policies](${SITE_URL}/docs/policies) for more`,
    );
  });

  it("preserves anchors", () => {
    expect(rewriteLinksAbsolute("[Honesty](./policies.md#honesty)")).toBe(
      `[Honesty](${SITE_URL}/docs/policies#honesty)`,
    );
  });

  it("rewrites every link on a line", () => {
    const out = rewriteLinksAbsolute("[a](./x402.md) and [b](./agent-keys.md)");
    expect(out).toBe(`[a](${SITE_URL}/docs/x402) and [b](${SITE_URL}/docs/agent-keys)`);
  });

  it("leaves external links and in-page anchors alone", () => {
    const src = "[x402](https://x402.org) and [Limits](#limits-and-operational-caveats)";
    expect(rewriteLinksAbsolute(src)).toBe(src);
  });
});

describe("pagePreamble / toAgentMarkdown", () => {
  it("names the page and links canonical, raw, index, and full-corpus URLs", () => {
    const pre = pagePreamble(page());
    expect(pre).toContain("x402 Agentic Payments");
    expect(pre).toContain(`${SITE_URL}/docs/x402`);
    expect(pre).toContain(`${SITE_URL}/docs/x402.md`);
    expect(pre).toContain(`${SITE_URL}/llms.txt`);
    expect(pre).toContain(`${SITE_URL}/llms-full.txt`);
  });

  it("keeps the page H1 and rewrites its links", () => {
    const out = toAgentMarkdown(page(), "# Title\n\nsee [p](./policies.md)\n");
    expect(out).toContain("# Title");
    expect(out).toContain(`](${SITE_URL}/docs/policies)`);
    expect(out.startsWith("<!--")).toBe(true);
  });
});

describe("buildLlmsIndex", () => {
  it("groups pages by section and links the raw .md URL with a description", () => {
    const out = buildLlmsIndex([
      { section: "x402 Payments", pages: [page()] },
      { section: "Reference", pages: [page({ slug: "advanced", title: "Advanced" })] },
    ]);
    expect(out).toContain("## x402 Payments");
    expect(out).toContain("## Reference");
    expect(out).toContain(
      `- [x402 Agentic Payments](${SITE_URL}/docs/x402.md): Pay HTTP-402 resources.`,
    );
    expect(out).toContain(`${SITE_URL}/llms-full.txt`);
  });

  it("lists every registry page by default", () => {
    const out = buildLlmsIndex();
    for (const p of DOC_PAGES) {
      expect(out).toContain(`${SITE_URL}/docs/${p.slug}.md`);
    }
  });
});

describe("buildLlmsFull", () => {
  it("concatenates pages with source markers and rewritten links", () => {
    const pages = [page(), page({ slug: "policies", title: "Policies" })];
    const read = (slug: string) => `# ${slug}\n\n[link](./agent-keys.md)\n`;
    const out = buildLlmsFull(pages, read);
    expect(out).toContain(`<!-- Source: ${SITE_URL}/docs/x402 -->`);
    expect(out).toContain(`<!-- Source: ${SITE_URL}/docs/policies -->`);
    expect(out.match(/\n---\n/g)).toHaveLength(pages.length - 1);
    expect(out).not.toContain("](./");
  });
});

describe("registry hygiene", () => {
  it("every page has a non-empty description", () => {
    for (const p of DOC_PAGES) {
      expect(p.description.length, p.slug).toBeGreaterThan(20);
    }
  });

  it("slugs are unique", () => {
    const slugs = DOC_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("against the real content files", () => {
  it("getAgentMarkdown serves a known page with H1 kept and no relative links left", () => {
    const out = getAgentMarkdown("facilitator");
    expect(out).toBeDefined();
    expect(out).toContain("# x402 Facilitator");
    expect(out).not.toContain("](./");
  });

  it("returns undefined for an unknown slug", () => {
    expect(getAgentMarkdown("does-not-exist")).toBeUndefined();
  });

  it("every registry page exists on disk and rewrites cleanly", () => {
    for (const p of DOC_PAGES) {
      const rewritten = rewriteLinksAbsolute(readDocSource(p.slug));
      expect(rewritten, p.slug).not.toContain("](./");
    }
  });
});
