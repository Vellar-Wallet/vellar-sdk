import { Command } from "commander";
import { decodeChallenge } from "./quote.js";
import { DEFAULT_FACILITATOR_URL } from "./search.js";

/** Outcome of probing one host. `ok` means usable; `networks` is what it advertises. */
export interface ProbeResult {
  target: string;
  ok: boolean;
  status?: number;
  networks: string[];
  detail: string;
}

/** CAIP-2 to the short name used elsewhere in this CLI. */
const NETWORK_ALIASES: Record<string, string> = {
  "stellar:pubnet": "mainnet",
  "stellar:testnet": "testnet",
};

function networkName(n: string): string {
  return NETWORK_ALIASES[n] ?? n;
}

/** Render / Railway / most proxies answer 5xx (or 404 with a marker) for suspended services. */
function describeBadStatus(res: Response): string {
  const routing = res.headers.get("x-render-routing");
  if (routing && /suspend/i.test(routing)) return `service suspended (${routing})`;
  return `${res.status} ${res.statusText}`.trim();
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return fetch(url, { method: "GET", signal: AbortSignal.timeout(ms) });
}

/**
 * Probe a paid resource: it must be reachable and, if it demands payment, must
 * carry a decodable 402 challenge. The networks in the challenge are reported
 * so a testnet-to-pubnet flip is visible instead of discovered at settlement.
 * GET, never HEAD: a HEAD request carries no payment challenge.
 */
export async function probeResource(url: string, timeoutMs = 10_000): Promise<ProbeResult> {
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (res.status === 402) {
      const challenge = decodeChallenge(res.headers.get("payment-required"), await res.text());
      if (!challenge) {
        return { target: url, ok: false, status: 402, networks: [], detail: "402 but challenge could not be decoded" };
      }
      const networks = [...new Set((challenge.accepts ?? []).map((a) => a.network))];
      return {
        target: url,
        ok: networks.length > 0,
        status: 402,
        networks,
        detail: networks.length ? "payment challenge OK" : "402 challenge lists no payment options",
      };
    }
    if (res.ok) return { target: url, ok: true, status: res.status, networks: [], detail: "reachable, no payment required" };
    return { target: url, ok: false, status: res.status, networks: [], detail: describeBadStatus(res) };
  } catch (err) {
    return { target: url, ok: false, networks: [], detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Probe a facilitator: `/supported` must answer and lists the networks it will
 * settle on; `/discovery/search` must answer for the Bazaar to work.
 */
export async function probeFacilitator(base: string, timeoutMs = 10_000): Promise<ProbeResult> {
  try {
    const supportedUrl = new URL("/supported", base);
    const res = await fetchWithTimeout(supportedUrl.toString(), timeoutMs);
    if (!res.ok) {
      return { target: base, ok: false, status: res.status, networks: [], detail: describeBadStatus(res) };
    }
    const data = (await res.json()) as { kinds?: { network?: string }[] };
    const networks = [...new Set((data.kinds ?? []).map((k) => k.network).filter((n): n is string => !!n))];

    const searchUrl = new URL("/discovery/search", base);
    searchUrl.searchParams.set("query", "preflight");
    searchUrl.searchParams.set("limit", "1");
    const search = await fetchWithTimeout(searchUrl.toString(), timeoutMs);
    if (!search.ok) {
      return { target: base, ok: false, status: search.status, networks, detail: `/discovery/search: ${describeBadStatus(search)}` };
    }
    return { target: base, ok: networks.length > 0, status: 200, networks, detail: "facilitator OK" };
  } catch (err) {
    return { target: base, ok: false, networks: [], detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Apply `--expect-network`: a reachable host on the wrong network is not usable. */
export function checkExpectedNetwork(r: ProbeResult, expected?: string): ProbeResult {
  if (!expected || !r.ok || r.networks.length === 0) return r;
  if (r.networks.some((n) => networkName(n) === expected || n === expected)) return r;
  return { ...r, ok: false, detail: `expected ${expected}, host advertises ${r.networks.map(networkName).join(", ")}` };
}

export function makePreflightCommand(): Command {
  return new Command("preflight")
    .description("Check that a deployment is usable end to end, and on which network")
    .argument("[urls...]", "Paid resource URLs to probe (each must answer with a 402 challenge)")
    .option(
      "--facilitator <url>",
      "Facilitator URL",
      process.env.VELLAR_FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL,
    )
    .option("--expect-network <network>", "Fail if a host advertises a different network (testnet|mainnet)")
    .option("--timeout <ms>", "Per-request timeout in milliseconds", "10000")
    .option("--json", "Output raw JSON")
    .action(
      async (urls: string[], opts: { facilitator: string; expectNetwork?: string; timeout: string; json?: boolean }) => {
        const timeout = Number(opts.timeout) || 10_000;
        const results = (
          await Promise.all([
            probeFacilitator(opts.facilitator, timeout),
            ...urls.map((u) => probeResource(u, timeout)),
          ])
        ).map((r) => checkExpectedNetwork(r, opts.expectNetwork));

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          for (const r of results) {
            const nets = r.networks.length ? ` [${r.networks.map(networkName).join(", ")}]` : "";
            console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.target}${nets}  ${r.detail}`);
          }
        }
        if (results.some((r) => !r.ok)) process.exit(1);
      },
    );
}
