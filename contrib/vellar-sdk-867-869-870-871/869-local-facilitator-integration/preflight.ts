// Environment parsing and preflight for the opt-in local facilitator
// integration test (issue #869). Reference implementation under contrib/.
//
// The suite is deliberately skipped unless ALL of the documented variables are
// set, and it refuses non-local endpoints because the first settlement for a
// resource URL writes a permanent public catalog entry. A single short probe
// gives a clear skip reason instead of a confusing connection error later.

const ENV_NAMES = [
  "VELLAR_LOCAL_FACILITATOR_URL",
  "VELLAR_X402_SELLER_URL",
  "VELLAR_X402_RPC_URL",
  "VELLAR_X402_SECRET",
  "VELLAR_X402_TEST_ASSET",
] as const;

export interface LocalFacilitatorEnv {
  facilitatorUrl: string;
  sellerUrl: string;
  rpcUrl: string;
  secret: string;
  asset: string;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export function isLocalUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(host)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return host.endsWith(".localhost");
}

/** Parse the opt-in environment. Returns null when nothing is configured, so
 * the suite can skip cleanly. Throws when only part of it is configured, so a
 * typo fails loudly instead of silently disabling the test. */
export function readLocalFacilitatorEnv(
  source: Record<string, string | undefined> = process.env,
): LocalFacilitatorEnv | null {
  const values = ENV_NAMES.map((name) => source[name]?.trim() ?? "");
  const setCount = values.filter(Boolean).length;
  if (setCount === 0) return null;
  if (setCount !== ENV_NAMES.length) {
    const missing = ENV_NAMES.filter((name) => !source[name]?.trim()).join(", ");
    throw new Error(
      `local facilitator integration environment is only partially set. Missing: ${missing}. ` +
        `Set all of ${ENV_NAMES.join(", ")}, or none of them.`,
    );
  }

  const [facilitatorUrl, sellerUrl, rpcUrl, secret, asset] = values as [
    string, string, string, string, string,
  ];

  for (const [name, url] of [
    ["VELLAR_LOCAL_FACILITATOR_URL", facilitatorUrl],
    ["VELLAR_X402_SELLER_URL", sellerUrl],
  ] as const) {
    if (!isLocalUrl(url)) {
      throw new Error(
        `${name} points at ${url}, which is not localhost. This suite refuses to ` +
          `settle against a hosted facilitator because the first settlement for a ` +
          `resource URL writes a permanent public catalog entry.`,
      );
    }
  }

  return { facilitatorUrl, sellerUrl, rpcUrl, secret, asset };
}

export type FetchProbe = (url: string, init?: RequestInit) => Promise<Response>;

/** One short GET against the configured facilitator. Any HTTP response means
 * the process is up; only transport errors or a timeout mean it is absent.
 * Returns null when reachable, otherwise a message suitable for a skip title. */
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
    return (
      `local facilitator at ${facilitatorUrl} is not reachable (${detail}). ` +
      `Start it with the one-command setup in website/content/docs/operators/limits.md`
    );
  }
}
