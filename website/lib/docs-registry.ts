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
// Grouped by domain so the docs read as an x402 payment platform, not a
// passkey-wallet SDK: Getting Started → x402 Payments (the core) →
// Agents & Provenance → Wallet & Passkeys → Reference.
export const DOC_PAGES: DocPage[] = [
  { slug: "hackathon", title: "Vellar × Stellar Hackathon", nav: "Hackathon", section: "Hackathon" },

  // Getting Started
  { slug: "introduction", title: "Introduction", nav: "Introduction", section: "Getting Started" },
  { slug: "installation", title: "Installation", nav: "Installation", section: "Getting Started" },
  { slug: "quickstart", title: "Quickstart", nav: "Quickstart", section: "Getting Started" },

  // x402 Payments — the core of the platform
  { slug: "x402", title: "x402 Agentic Payments", nav: "x402 Payments", section: "x402 Payments" },
  { slug: "facilitator", title: "x402 Facilitator & Bazaar", nav: "Facilitator & Bazaar", section: "x402 Payments" },

  // Agents & Provenance
  { slug: "agent-keys", title: "Agent Keys", nav: "Agent keys", section: "Agents & Provenance" },
  { slug: "policies", title: "Policies & Provenance", nav: "Policies & provenance", section: "Agents & Provenance" },

  // Wallet & Passkeys — one pillar, not the whole story
  { slug: "how-it-works", title: "How It Works", nav: "How it works", section: "Wallet & Passkeys" },
  { slug: "wallet-methods", title: "Wallet Methods", nav: "Wallet methods", section: "Wallet & Passkeys" },
  { slug: "security", title: "Security", nav: "Security", section: "Wallet & Passkeys" },

  // Reference
  { slug: "api-reference", title: "API Reference", nav: "createVellarWallet", section: "Reference" },
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
