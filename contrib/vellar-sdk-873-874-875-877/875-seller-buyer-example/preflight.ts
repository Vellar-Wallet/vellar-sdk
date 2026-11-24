// Environment and preflight for the opt-in seller and buyer example (#875).
// Self-contained under contrib/ so the example can be copied without depending
// on another issue's folder.

const ENV_NAMES = [
  "VELLAR_LOCAL_FACILITATOR_URL",
  "VELLAR_X402_RPC_URL",
  "VELLAR_X402_SECRET",
  "VELLAR_X402_TEST_ASSET",
] as const;

export interface SellerBuyerEnv {
  facilitatorUrl: string;
  rpcUrl: string;
  secret: string;
  asset: string;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export function isLocalUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (LOCAL_HOSTNAMES.has(host)) return true;
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** null means "not configured, skip". A partial configuration throws so a typo
 * cannot silently turn the worked example into a no-op. */
export function readSellerBuyerEnv(
  source: Record<string, string | undefined> = process.env,
): SellerBuyerEnv | null {
  const values = ENV_NAMES.map((name) => source[name]?.trim() ?? "");
  const setCount = values.filter(Boolean).length;
  if (setCount === 0) return null;
  if (setCount !== ENV_NAMES.length) {
    const missing = ENV_NAMES.filter((name) => !source[name]?.trim()).join(", ");
    throw new Error(
      `seller/buyer example environment is only partially set. Missing: ${missing}. ` +
        `Set all of ${ENV_NAMES.join(", ")}, or none of them.`,
    );
  }

  const [facilitatorUrl, rpcUrl, secret, asset] = values as [string, string, string, string];
  if (!isLocalUrl(facilitatorUrl)) {
    throw new Error(
      `VELLAR_LOCAL_FACILITATOR_URL points at ${facilitatorUrl}, which is not localhost. ` +
        `This example refuses to settle against a hosted facilitator because the first ` +
        `settlement for a resource URL writes a permanent public catalog entry.`,
    );
  }
  return { facilitatorUrl, rpcUrl, secret, asset };
}

export type FetchProbe = (url: string, init?: RequestInit) => Promise<Response>;

/** One short GET. Any HTTP response means the facilitator is up; only transport
 * errors or a timeout mean it is absent. Returns a skip reason or null. */
export async function probeFacilitator(
  facilitatorUrl: string,
  fetchImpl: FetchProbe = fetch,
  timeoutMs = 1500,
): Promise<string | null> {
  try {
    await fetchImpl(facilitatorUrl, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `local facilitator at ${facilitatorUrl} is not reachable (${detail})`;
  }
}
