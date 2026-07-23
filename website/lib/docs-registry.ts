// Client-safe docs registry — pure data, no Node APIs, so it can be imported by
// both server and client components (the sidebar nav uses it). File reading
// lives in ./docs (server-only).

export interface DocPage {
  slug: string;
  title: string;
  /** Short label for the sidebar. */
  nav: string;
  /** Sidebar section grouping. */
  section: string;
}

// Ordered table of contents — drives the sidebar and next/prev.
export const DOC_PAGES: DocPage[] = [
  { slug: "introduction", title: "Introduction", nav: "Introduction", section: "Getting Started" },
  { slug: "installation", title: "Installation", nav: "Installation", section: "Getting Started" },
  { slug: "quickstart", title: "Quickstart", nav: "Quickstart", section: "Getting Started" },
  { slug: "how-it-works", title: "How It Works", nav: "How It Works", section: "Concepts" },
  { slug: "security", title: "Security", nav: "Security", section: "Concepts" },
  { slug: "api-reference", title: "API Reference", nav: "createVelaWallet", section: "Reference" },
  { slug: "wallet-methods", title: "Wallet Methods", nav: "Wallet methods", section: "Reference" },
  { slug: "policies", title: "Policies", nav: "Policies", section: "Reference" },
  { slug: "advanced", title: "Advanced Usage", nav: "Advanced", section: "Reference" },
];

/** Sections in sidebar order, derived from DOC_PAGES. */
export const DOC_SECTIONS: { section: string; pages: DocPage[] }[] = DOC_PAGES.reduce(
  (acc, page) => {
    const existing = acc.find((s) => s.section === page.section);
    if (existing) existing.pages.push(page);
    else acc.push({ section: page.section, pages: [page] });
    return acc;
  },
  [] as { section: string; pages: DocPage[] }[],
);

export function getDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}
