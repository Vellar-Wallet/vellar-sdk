// The localhost guard.
//
// WHY THIS IS CODE AND NOT A README WARNING: settling against the shared hosted
// facilitator writes a PERMANENT public catalog entry for the resource URL — the
// first settlement for a URL creates it and nobody can delete it afterwards. A
// copied env var is all it takes, and the mistake is irreversible. So the check
// runs before any integration test can issue a request, and it throws.
//
// Exported (and unit-tested) rather than inlined so the rule itself is verified
// by the hermetic suite.

/** Hostnames that are unambiguously this machine. */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export class NonLocalEndpointError extends Error {
  constructor(name: string, url: string) {
    super(
      `${name} points at ${url}, which is not localhost. Integration tests refuse to run ` +
        `against a non-local facilitator or seller: the first settlement for a resource URL ` +
        `writes a PERMANENT public catalog entry that cannot be deleted. Start the local ` +
        `stack and point this at 127.0.0.1.`,
    );
    this.name = "NonLocalEndpointError";
  }
}

/** True when the URL's host is this machine. IPv4 loopback (127.0.0.0/8) included. */
export function isLocalUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(host)) return true;
  // The whole 127.0.0.0/8 block, and the reserved *.localhost suffix.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host.endsWith(".localhost")) return true;
  return false;
}

/** Throw unless every supplied endpoint is local. */
export function assertLocalEndpoints(endpoints: Record<string, string>): void {
  for (const [name, url] of Object.entries(endpoints)) {
    if (!isLocalUrl(url)) throw new NonLocalEndpointError(name, url);
  }
}

export interface IntegrationEnv {
  facilitatorUrl: string;
  sellerUrl: string;
  secret: string;
  asset: string;
}

/**
 * Read the integration environment, or return null when it is not configured
 * (so the suite can skip rather than fail on a machine with no local stack).
 *
 * A partially-configured environment is an ERROR, not a skip — a half-set
 * environment is how a test silently stops covering anything.
 */
export function readIntegrationEnv(env: NodeJS.ProcessEnv = process.env): IntegrationEnv | null {
  const facilitatorUrl = env.VELLAR_X402_FACILITATOR_URL?.trim();
  const sellerUrl = env.VELLAR_X402_SELLER_URL?.trim();
  const secret = env.VELLAR_X402_SECRET?.trim();
  const asset = env.VELLAR_X402_TEST_ASSET?.trim();

  const set = [facilitatorUrl, sellerUrl, secret, asset].filter(Boolean).length;
  if (set === 0) return null;
  if (set < 4) {
    throw new Error(
      "Integration environment is only partially set. Provide ALL of " +
        "VELLAR_X402_FACILITATOR_URL, VELLAR_X402_SELLER_URL, VELLAR_X402_SECRET and " +
        "VELLAR_X402_TEST_ASSET, or none of them.",
    );
  }

  // Enforced before anything can issue a request.
  assertLocalEndpoints({
    VELLAR_X402_FACILITATOR_URL: facilitatorUrl!,
    VELLAR_X402_SELLER_URL: sellerUrl!,
  });

  return {
    facilitatorUrl: facilitatorUrl!,
    sellerUrl: sellerUrl!,
    secret: secret!,
    asset: asset!,
  };
}
