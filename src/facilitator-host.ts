// Facilitator discovery aid: is the configured facilitator URL the documented
// hosted testnet instance, or something else (assumed self-run / third-party)?
//
// The hosted instance is a one-instance testnet demo with no uptime commitment
// (see website/content/docs/operators/limits.md). This helper is a
// configuration-awareness aid only — it compares URLs, it never makes a
// network call and never throws.

/** The documented hosted testnet facilitator (website/content/docs/operators/limits.md). */
export const HOSTED_TESTNET_FACILITATOR_URL = "https://vellar-facilitator.onrender.com";

export type FacilitatorKind = "hosted-testnet" | "self-run";

/** Lowercased origin + path with a trailing slash stripped, or null if unparseable. */
function normalise(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classify a facilitator URL. Only the exact documented hosted testnet URL
 * (ignoring case, a trailing slash, and the default port) is `"hosted-testnet"`;
 * any other value — including an unparseable one — is `"self-run"`.
 */
export function classifyFacilitator(facilitatorUrl: string): FacilitatorKind {
  const given = normalise(facilitatorUrl);
  return given !== null && given === normalise(HOSTED_TESTNET_FACILITATOR_URL) ? "hosted-testnet" : "self-run";
}

/** Convenience boolean over {@link classifyFacilitator}. */
export function isHostedTestnetFacilitator(facilitatorUrl: string): boolean {
  return classifyFacilitator(facilitatorUrl) === "hosted-testnet";
}
