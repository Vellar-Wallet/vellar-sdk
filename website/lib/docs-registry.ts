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

  // Getting Started — restructured pages under content/docs/getting-started.
  { slug: "getting-started/introduction", title: "Introduction", nav: "Introduction",
    section: "Getting Started",
    description: "What Vellar is and where to start." },
  { slug: "getting-started/how-it-works", title: "How It Works", nav: "How It Works",
    section: "Getting Started",
    description: "Passkeys, smart accounts, and the payment loop." },
  { slug: "getting-started/installation", title: "Installation", nav: "Installation",
    section: "Getting Started",
    description: "Install the SDK and understand what your backend supplies." },
  { slug: "getting-started/quickstart", title: "Quickstart", nav: "Quickstart",
    section: "Getting Started",
    description: "Create a wallet and make a payment in five minutes." },

  // Buyers — the paying side of the x402 loop.
  { slug: "buyers/pay-for-a-resource", title: "Pay for a Resource",
    nav: "Pay for a Resource", section: "Buyers",
    description: "Pay an x402 resource from a Vellar smart account." },
  { slug: "buyers/sign-and-pay", title: "Sign and Pay", nav: "Sign and Pay",
    section: "Buyers",
    description: "How the x402 payment loop works step by step." },
  { slug: "buyers/discover-services", title: "Discover Services",
    nav: "Discover Services", section: "Buyers",
    description: "Search the Bazaar to find x402 resources." },
  { slug: "buyers/spend-controls", title: "Spend Controls", nav: "Spend Controls",
    section: "Buyers",
    description: "maxAmount vs the on-chain spending-limit policy." },

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
  { slug: "wallet-methods", title: "Wallet Methods", nav: "Wallet methods", section: "Wallet & Passkeys",
    description: "Every method on the wallet handle: create, connect, pay, balances, transaction status, and sessions." },
  { slug: "security", title: "Security", nav: "Security", section: "Wallet & Passkeys",
    description: "The wallet and SDK security model: no key custody, no silent signing, and the on-chain policy guarantees." },

  // Agent tooling — the servers and editor tooling an agent developer wires up.
  { slug: "agent-tooling/mcp-payer", title: "MCP Payer", nav: "MCP payer",
    section: "Agent Tooling",
    description: "An MCP server that lets an AI agent pay for x402 resources, with process-level and on-chain budget layers." },
  { slug: "agent-tooling/vscode", title: "VS Code Extension", nav: "VS Code extension",
    section: "Agent Tooling",
    description: "Add x402 payment gating to an HTTP endpoint in one command from VS Code." },

  // Concepts — first-principles explanations, readable in any order.
  { slug: "concepts/payment-loop", title: "The Payment Loop", nav: "The payment loop",
    section: "Concepts",
    description: "Every participant and every step in an x402 payment, and why each step exists." },
  { slug: "concepts/exact-scheme", title: "The Exact Scheme", nav: "Exact scheme",
    section: "Concepts",
    description: "Fixed-price settlement: what the buyer signs, ledger-based expiration, and what the facilitator checks." },
  { slug: "concepts/upto-scheme", title: "The Upto Scheme", nav: "Upto scheme",
    section: "Concepts",
    description: "Metered settlement: why it needs a Soroban contract, and the two guarantees that contract enforces." },
  { slug: "concepts/bazaar-and-discovery", title: "Bazaar and Discovery", nav: "Bazaar and discovery",
    section: "Concepts",
    description: "How a resource enters the catalog, what ownerVerified means, and which trust signals actually work." },
  { slug: "concepts/stellar-essentials", title: "Stellar Essentials", nav: "Stellar essentials",
    section: "Concepts",
    description: "Trustlines, SEP-41 amounts, fee sponsorship, authorization entries, and G versus C accounts." },

  // Reference
  { slug: "api-reference", title: "API Reference", nav: "createVellarWallet", section: "Reference",
    description: "Configuration reference for createVellarWallet and the runtime seams it accepts." },
  { slug: "advanced", title: "Advanced Usage", nav: "Advanced", section: "Reference",
    description: "Lower-level building blocks the SDK exports for custom transports and integrations." },
  { slug: "reference/error-codes", title: "Error Codes", nav: "Error codes", section: "Reference",
    description: "Every error, its cause, whether retrying is safe, and which ones mean money already moved." },
  { slug: "reference/conformance", title: "Conformance", nav: "Conformance", section: "Reference",
    description: "Wire-level verification with real settlement hashes you can check against Horizon yourself." },
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
