// Agent-facing docs exports: raw-markdown pages, the llms.txt index, and the
// llms-full.txt corpus. Everything derives from the same content/docs source
// the site renders — there is no second copy to keep in sync.
//
// The pure transforms take content as arguments (no fs) so they are unit-
// testable; the get* wrappers below bind them to the filesystem.

import { readDocSource } from "./docs";
import { DOC_PAGES, DOC_SECTIONS, getDocPage, type DocPage } from "./docs-registry";

export const SITE_URL = "https://docs.vellar.xyz";

/**
 * Rewrite in-repo relative links (./foo.md, ./foo.md#anchor) to absolute
 * site URLs, so a copied page still lets an agent follow references.
 */
export function rewriteLinksAbsolute(raw: string): string {
  return raw.replace(/\]\(\.\/([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/gi, `](${SITE_URL}/docs/$1$2)`);
}

/**
 * The header prepended to a single copied/fetched page: where it came from,
 * and where the rest of the docs live if the agent needs more context.
 */
export function pagePreamble(page: DocPage): string {
  return [
    "<!--",
    `  Vellar SDK docs — ${page.title}`,
    `  Source: ${SITE_URL}/docs/${page.slug} (this file: ${SITE_URL}/docs/${page.slug}.md)`,
    `  Index of all pages: ${SITE_URL}/llms.txt · Full docs in one file: ${SITE_URL}/llms-full.txt`,
    "-->",
    "",
    "",
  ].join("\n");
}

/** A single page formatted for an agent: preamble + absolute links, H1 kept. */
export function toAgentMarkdown(page: DocPage, raw: string): string {
  return pagePreamble(page) + rewriteLinksAbsolute(raw);
}

/** The llms.txt index: title, blurb, and a link per page grouped by section. */
export function buildLlmsIndex(
  sections: { section: string; pages: DocPage[] }[] = DOC_SECTIONS,
): string {
  const lines: string[] = [
    "# Vellar SDK",
    "",
    "> Vellar is a programmable payment platform for Stellar — a hosted x402",
    "> facilitator with Bazaar discovery, on-chain spending and provenance",
    "> policies, and a passkey smart wallet. `vellar-sdk` on npm is the",
    "> TypeScript client. These docs cover both the SDK and the hosted services.",
    "",
    "Every page is served as raw markdown by appending `.md` to its URL.",
    `The entire docs in one file: ${SITE_URL}/llms-full.txt`,
    "",
  ];
  for (const { section, pages } of sections) {
    lines.push(`## ${section}`, "");
    for (const p of pages) {
      lines.push(`- [${p.title}](${SITE_URL}/docs/${p.slug}.md): ${p.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** The llms-full.txt corpus: every page, absolute links, source markers. */
export function buildLlmsFull(
  pages: DocPage[] = DOC_PAGES,
  read: (slug: string) => string = readDocSource,
): string {
  const header = [
    "<!--",
    "  Vellar SDK — full documentation in one file, for AI agents and LLMs.",
    `  Canonical site: ${SITE_URL} · Page index: ${SITE_URL}/llms.txt`,
    "-->",
    "",
  ].join("\n");
  const body = pages
    .map(
      (p) =>
        `<!-- Source: ${SITE_URL}/docs/${p.slug} -->\n\n${rewriteLinksAbsolute(read(p.slug))}`,
    )
    .join("\n\n---\n\n");
  return `${header}\n${body}\n`;
}

/** Agent-formatted markdown for one page, or undefined for an unknown slug. */
export function getAgentMarkdown(slug: string): string | undefined {
  const page = getDocPage(slug);
  if (!page) return undefined;
  return toAgentMarkdown(page, readDocSource(slug));
}

export function getLlmsIndex(): string {
  return buildLlmsIndex();
}

export function getLlmsFull(): string {
  return buildLlmsFull();
}
