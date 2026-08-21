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
  /** One-line summary — page <meta> description and the llms.txt index. */
  description: string;
}

// Ordered table of contents — drives the sidebar and next/prev.
// Grouped by domain so the docs read as an x402 payment platform, not a
// passkey-wallet SDK: Getting Started → x402 Payments (the core) →
// Agents & Provenance → Wallet & Passkeys → Reference.
export const DOC_PAGES: DocPage[] = [
  { slug: "hackathon", title: "Vellar × Stellar Hackathon", nav: "Hackathon", section: "Hackathon",
    description: "Hackathon tracks, judging criteria, and starter ideas for building on Vellar's x402 payment stack." },

  // Getting Started
  { slug: "introduction", title: "Introduction", nav: "Introduction", section: "Getting Started",
    description: "What Vellar is: a hosted x402 facilitator with Bazaar discovery, on-chain spending/provenance policies, and a passkey smart wallet for Stellar." },
  { slug: "installation", title: "Installation", nav: "Installation", section: "Getting Started",
    description: "Install vellar-sdk from npm and set up its peer dependencies." },
  { slug: "quickstart", title: "Quickstart", nav: "Quickstart", section: "Getting Started",
    description: "Create a passkey smart wallet and make a fee-sponsored payment in a few minutes." },

  // x402 Payments — the core of the platform
  { slug: "x402", title: "x402 Agentic Payments", nav: "x402 Payments", section: "x402 Payments",
    description: "Pay HTTP-402 resources from a smart account with wallet.x402.fetch() — the give-your-agent-a-budget-not-your-keys flow." },
  { slug: "facilitator", title: "x402 Facilitator & Bazaar", nav: "Facilitator & Bazaar", section: "x402 Payments",
    description: "The hosted Stellar x402 facilitator: verify/settle endpoints, Bazaar discovery and search, trust signals, and operational limits." },
  { slug: "upto", title: "upto — Metered Payments", nav: "Upto (metered)", section: "x402 Payments",
    description: "The experimental upto scheme: authorize a spending ceiling with one signature, settle for the actual metered amount, enforced on-ledger by a Soroban contract." },

  // Agents & Provenance
  { slug: "agent-keys", title: "Agent Keys", nav: "Agent keys", section: "Agents & Provenance",
    description: "Mint scoped agent session keys bounded by on-chain policies, and revoke them remotely." },
  { slug: "policies", title: "Policies & Provenance", nav: "Policies & provenance", section: "Agents & Provenance",
    description: "Deploy and attach spending-limit and verified-only policies enforced inside the wallet's __check_auth." },

  // Wallet & Passkeys — one pillar, not the whole story
  { slug: "how-it-works", title: "How It Works", nav: "How it works", section: "Wallet & Passkeys",
    description: "Passkey onboarding, Soroban smart-contract accounts, sponsored submission, and programmable policies." },
  { slug: "wallet-methods", title: "Wallet Methods", nav: "Wallet methods", section: "Wallet & Passkeys",
    description: "Every method on the wallet handle: create, connect, pay, balances, transaction status, and sessions." },
  { slug: "security", title: "Security", nav: "Security", section: "Wallet & Passkeys",
    description: "The wallet and SDK security model: no key custody, no silent signing, and the on-chain policy guarantees." },

  // Reference
  { slug: "api-reference", title: "API Reference", nav: "createVellarWallet", section: "Reference",
    description: "Configuration reference for createVellarWallet and the runtime seams it accepts." },
  { slug: "advanced", title: "Advanced Usage", nav: "Advanced", section: "Reference",
    description: "Lower-level building blocks the SDK exports for custom transports and integrations." },
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
