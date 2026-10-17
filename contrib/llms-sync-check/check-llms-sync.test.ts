import { describe, it, expect, vi } from "vitest";
import { validateLlmsSync } from "./check-llms-sync.mjs";

// Mock the docs-agent and docs-registry modules
vi.mock("../../website/lib/docs-agent.js", () => ({
  buildLlmsIndex: vi.fn(),
  buildLlmsFull: vi.fn(),
}));

vi.mock("../../website/lib/docs-registry.js", () => ({
  DOC_PAGES: [
    {
      slug: "getting-started/introduction",
      title: "Introduction",
      nav: "Introduction",
      section: "Getting Started",
      tab: "guides",
      description: "What Vellar is and where to start.",
    },
    {
      slug: "x402",
      title: "x402 Agentic Payments",
      nav: "x402 Payments",
      section: "x402 Payments",
      tab: "reference",
      description: "Pay HTTP-402 resources from a smart account.",
    },
    {
      slug: "buyers/pay-for-a-resource",
      title: "Pay for a Resource",
      nav: "Pay for a Resource",
      section: "Buyers",
      tab: "guides",
      description: "Pay an x402 resource from a Vellar smart account.",
    },
  ],
}));

import * as docsAgent from "../../website/lib/docs-agent.js";
import * as docsRegistry from "../../website/lib/docs-registry.js";

describe("validateLlmsSync", () => {
  it("passes when llms.txt and llms-full.txt contain all registry pages", () => {
    const indexContent = `
## Getting Started
- [Introduction](https://docs.vellar.xyz/docs/getting-started/introduction.md): What Vellar is and where to start.

## x402 Payments
- [x402 Agentic Payments](https://docs.vellar.xyz/docs/x402.md): Pay HTTP-402 resources.

## Buyers
- [Pay for a Resource](https://docs.vellar.xyz/docs/buyers/pay-for-a-resource.md): Pay an x402 resource.
    `;

    const corpusContent = `
<!-- Source: https://docs.vellar.xyz/docs/getting-started/introduction -->
# Introduction
...

---

<!-- Source: https://docs.vellar.xyz/docs/x402 -->
# x402
...

---

<!-- Source: https://docs.vellar.xyz/docs/buyers/pay-for-a-resource -->
# Pay for a Resource
...
    `;

    vi.mocked(docsAgent.buildLlmsIndex).mockReturnValue(indexContent);
    vi.mocked(docsAgent.buildLlmsFull).mockReturnValue(corpusContent);

    const result = validateLlmsSync();

    expect(result.errors).toHaveLength(0);
    expect(result.indexSlugs.size).toBe(3);
    expect(result.corpusSlugs.size).toBe(3);
  });

  it("fails when a page is missing from llms-full.txt", () => {
    const indexContent = `
## Getting Started
- [Introduction](https://docs.vellar.xyz/docs/getting-started/introduction.md): What Vellar is.

## x402 Payments
- [x402 Agentic Payments](https://docs.vellar.xyz/docs/x402.md): Pay HTTP-402 resources.

## Buyers
- [Pay for a Resource](https://docs.vellar.xyz/docs/buyers/pay-for-a-resource.md): Pay an x402 resource.
    `;

    // Missing buyers/pay-for-a-resource from corpus
    const corpusContent = `
<!-- Source: https://docs.vellar.xyz/docs/getting-started/introduction -->
# Introduction
...

---

<!-- Source: https://docs.vellar.xyz/docs/x402 -->
# x402
...
    `;

    vi.mocked(docsAgent.buildLlmsIndex).mockReturnValue(indexContent);
    vi.mocked(docsAgent.buildLlmsFull).mockReturnValue(corpusContent);

    const result = validateLlmsSync();

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Missing from llms-full.txt");
    expect(result.errors[0]).toContain("buyers/pay-for-a-resource");
  });

  it("fails when llms.txt references an invalid slug not in registry", () => {
    // Index references a slug that doesn't exist in registry
    const indexContent = `
## Getting Started
- [Introduction](https://docs.vellar.xyz/docs/getting-started/introduction.md): What Vellar is.

## x402 Payments
- [x402 Agentic Payments](https://docs.vellar.xyz/docs/x402.md): Pay HTTP-402 resources.

## Buyers
- [Pay for a Resource](https://docs.vellar.xyz/docs/buyers/pay-for-a-resource.md): Pay an x402 resource.
- [Fake Page](https://docs.vellar.xyz/docs/buyers/nonexistent.md): This page doesn't exist.
    `;

    const corpusContent = `
<!-- Source: https://docs.vellar.xyz/docs/getting-started/introduction -->
# Introduction
...

---

<!-- Source: https://docs.vellar.xyz/docs/x402 -->
# x402
...

---

<!-- Source: https://docs.vellar.xyz/docs/buyers/pay-for-a-resource -->
# Pay for a Resource
...

---

<!-- Source: https://docs.vellar.xyz/docs/buyers/nonexistent -->
# Nonexistent
...
    `;

    vi.mocked(docsAgent.buildLlmsIndex).mockReturnValue(indexContent);
    vi.mocked(docsAgent.buildLlmsFull).mockReturnValue(corpusContent);

    const result = validateLlmsSync();

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("Invalid slug in llms.txt"))).toBe(true);
    expect(result.errors.some((e) => e.includes("buyers/nonexistent"))).toBe(true);
  });

  it("fails when a registry page is missing from llms.txt", () => {
    // Index is missing buyers/pay-for-a-resource
    const indexContent = `
## Getting Started
- [Introduction](https://docs.vellar.xyz/docs/getting-started/introduction.md): What Vellar is.

## x402 Payments
- [x402 Agentic Payments](https://docs.vellar.xyz/docs/x402.md): Pay HTTP-402 resources.
    `;

    const corpusContent = `
<!-- Source: https://docs.vellar.xyz/docs/getting-started/introduction -->
# Introduction
...

---

<!-- Source: https://docs.vellar.xyz/docs/x402 -->
# x402
...

---

<!-- Source: https://docs.vellar.xyz/docs/buyers/pay-for-a-resource -->
# Pay for a Resource
...
    `;

    vi.mocked(docsAgent.buildLlmsIndex).mockReturnValue(indexContent);
    vi.mocked(docsAgent.buildLlmsFull).mockReturnValue(corpusContent);

    const result = validateLlmsSync();

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("Missing from llms.txt"))).toBe(true);
    expect(result.errors.some((e) => e.includes("buyers/pay-for-a-resource"))).toBe(true);
  });

  it("detects multiple errors simultaneously", () => {
    // Missing one page from corpus, orphaned slug in index, missing one from index
    const indexContent = `
## Getting Started
- [Introduction](https://docs.vellar.xyz/docs/getting-started/introduction.md): What Vellar is.
- [Orphaned](https://docs.vellar.xyz/docs/orphaned.md): This slug doesn't exist in registry.
    `;

    const corpusContent = `
<!-- Source: https://docs.vellar.xyz/docs/getting-started/introduction -->
# Introduction
...

---

<!-- Source: https://docs.vellar.xyz/docs/orphaned -->
# Orphaned
...
    `;

    vi.mocked(docsAgent.buildLlmsIndex).mockReturnValue(indexContent);
    vi.mocked(docsAgent.buildLlmsFull).mockReturnValue(corpusContent);

    const result = validateLlmsSync();

    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.some((e) => e.includes("Missing from llms-full.txt"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Invalid slug in llms.txt"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Missing from llms.txt"))).toBe(true);
  });

  it("extracts slugs correctly including nested sections", () => {
    const indexContent = `
- [Getting Started](https://docs.vellar.xyz/docs/getting-started/introduction.md): Start here.
- [x402](https://docs.vellar.xyz/docs/x402.md): Core concept.
- [Nested Section](https://docs.vellar.xyz/docs/architecture/overview.md): Deep page.
    `;

    const corpusContent = `
<!-- Source: https://docs.vellar.xyz/docs/getting-started/introduction -->
...
<!-- Source: https://docs.vellar.xyz/docs/x402 -->
...
<!-- Source: https://docs.vellar.xyz/docs/architecture/overview -->
...
    `;

    vi.mocked(docsAgent.buildLlmsIndex).mockReturnValue(indexContent);
    vi.mocked(docsAgent.buildLlmsFull).mockReturnValue(corpusContent);

    const result = validateLlmsSync();

    expect(result.indexSlugs.has("getting-started/introduction")).toBe(true);
    expect(result.indexSlugs.has("x402")).toBe(true);
    expect(result.indexSlugs.has("architecture/overview")).toBe(true);
    expect(result.corpusSlugs.has("getting-started/introduction")).toBe(true);
    expect(result.corpusSlugs.has("x402")).toBe(true);
    expect(result.corpusSlugs.has("architecture/overview")).toBe(true);
  });

  it("handles deeply nested slugs with multiple path segments", () => {
    const indexContent = `
- [Deep](https://docs.vellar.xyz/docs/section/subsection/deep-page.md): Nested.
    `;

    const corpusContent = `
<!-- Source: https://docs.vellar.xyz/docs/section/subsection/deep-page -->
Content here.
    `;

    vi.mocked(docsAgent.buildLlmsIndex).mockReturnValue(indexContent);
    vi.mocked(docsAgent.buildLlmsFull).mockReturnValue(corpusContent);

    const result = validateLlmsSync();

    expect(result.indexSlugs.has("section/subsection/deep-page")).toBe(true);
    expect(result.corpusSlugs.has("section/subsection/deep-page")).toBe(true);
  });
});
