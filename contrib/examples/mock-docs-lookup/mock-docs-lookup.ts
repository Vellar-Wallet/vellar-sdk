// Example: a small mock docs registry lookup, similar in shape to the docs
// site's getDocPage, for use in tests of tooling that consumes such a
// lookup without depending on the real website content.
//
// Run with: npx tsx mock-docs-lookup.ts

export interface DocPage {
  slug: string;
  title: string;
}

const PAGES: DocPage[] = [
  { slug: "getting-started", title: "Getting Started" },
  { slug: "passkeys", title: "Passkeys & Smart Accounts" },
  { slug: "x402-payments", title: "x402 Agentic Payments" },
  { slug: "policies", title: "Programmable Account Policies" },
];

/**
 * Returns the DocPage for `slug`, or `undefined` for an unknown slug —
 * never throws, so a caller can treat a miss as "no such page" rather than
 * handling an exception.
 */
export function getDocPage(slug: string): DocPage | undefined {
  return PAGES.find((page) => page.slug === slug);
}

function main() {
  console.log("Known page:", getDocPage("passkeys"));
  console.log("Unknown page:", getDocPage("does-not-exist"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
