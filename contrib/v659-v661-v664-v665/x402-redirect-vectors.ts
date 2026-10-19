// Issue #665 — named adversarial vectors for redirects during an x402 payment.
//
// Proposed for src/x402-untrusted-vectors.ts alongside FENCE_VECTORS. They are
// a different kind of vector (transport, not text rendering), so they get their
// own interface rather than overloading FenceVector. Like the fence vectors they
// are behavioural: each says what a hostile seller sends and what any conforming
// client must do, so another implementation (e.g. the MCP payer) can run them.

export interface RedirectVector {
  name: string;
  /** Which request the seller redirects: the unpaid probe or the paid retry. */
  stage: "probe" | "payment-submission";
  /** The resource the client originally asked for. */
  requestUrl: string;
  /** The seller's redirect status. */
  status: 301 | 302 | 303 | 307 | 308;
  /** The `Location` header the seller sends (may be relative). */
  location: string;
  /** What a conforming client must do. */
  expect: "refuse" | "follow";
  rationale: string;
}

export const REDIRECT_VECTORS: readonly RedirectVector[] = Object.freeze([
  {
    name: "post-402-cross-origin-redirect",
    stage: "payment-submission",
    requestUrl: "https://res.test/paid",
    status: 302,
    location: "https://collector.attacker.example/settle",
    expect: "refuse",
    rationale:
      "The canonical retarget: the seller answers the paid retry with a redirect to a host it " +
      "controls. fetch would re-send the PAYMENT-SIGNATURE header there automatically.",
  },
  {
    name: "post-402-cross-origin-307-keeps-method",
    stage: "payment-submission",
    requestUrl: "https://res.test/paid",
    status: 307,
    location: "https://collector.attacker.example/settle",
    expect: "refuse",
    rationale: "307/308 also preserve the method and body, so a POST resource leaks its body too.",
  },
  {
    name: "post-402-scheme-downgrade",
    stage: "payment-submission",
    requestUrl: "https://res.test/paid",
    status: 301,
    location: "http://res.test/paid",
    expect: "refuse",
    rationale:
      "Same host, plaintext scheme: a different origin, and the signed payment would cross the " +
      "network unencrypted.",
  },
  {
    name: "post-402-sibling-subdomain",
    stage: "payment-submission",
    requestUrl: "https://res.test/paid",
    status: 302,
    location: "https://pay.res.test/paid",
    expect: "refuse",
    rationale: "A subdomain is a different origin and may be run by someone else.",
  },
  {
    name: "post-402-protocol-relative",
    stage: "payment-submission",
    requestUrl: "https://res.test/paid",
    status: 302,
    location: "//collector.attacker.example/settle",
    expect: "refuse",
    rationale: "A protocol-relative Location resolves to another host; it must not slip past a naive '/' check.",
  },
  {
    name: "probe-cross-origin-redirect",
    stage: "probe",
    requestUrl: "https://res.test/paid",
    status: 302,
    location: "https://collector.attacker.example/paid",
    expect: "refuse",
    rationale:
      "Redirecting the unpaid probe makes the client decode a 402 from the attacker's host and " +
      "pay ITS terms (payTo, amount) for a resource the user asked for elsewhere.",
  },
  {
    name: "post-402-same-origin-redirect",
    stage: "payment-submission",
    requestUrl: "https://res.test/paid",
    status: 307,
    location: "/paid/v2",
    expect: "follow",
    rationale: "Control: a redirect within the original origin is legitimate and is followed.",
  },
]);
