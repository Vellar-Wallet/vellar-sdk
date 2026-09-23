// Discovery + payment in one call.
//
// This is the ONE place this package reads the facilitator's HTTP API. The rest
// of the server deliberately does not: discovery is a separate MCP server that
// holds no keys, and an agent normally connects to both. The justification for
// folding one read-only search in here is that the alternative is worse — an
// agent that searches in one tool and pays in another has to carry a URL across
// the boundary, and a URL crossing that boundary is a URL an injected
// description can rewrite. Selecting and paying in a single call means the URL
// paid is the URL the facilitator returned, never one the model retyped.
//
// The ceiling is still the model's to supply and the server's to enforce: the
// session ledger is checked BEFORE the search, so a call that could not pay
// anything never reaches the network.

import type { PayerConfig } from "./config.js";
import type { SpendLedger } from "./ledger.js";
import { log } from "./output.js";
import type { FetchLike, PayResult, Payer } from "./payer.js";

/** Hosted facilitator, used when VELLAR_X402_FACILITATOR_URL is unset. */
export const DEFAULT_FACILITATOR_URL = "https://vellar-facilitator.onrender.com";

/** How many catalog entries to consider. More than this is noise for one call. */
const SEARCH_LIMIT = 10;

/** One payment option on a catalog entry. */
interface CatalogAccept {
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
  extra?: { areFeesSponsored?: boolean };
}

/** A catalog entry as returned by GET /discovery/search. */
interface CatalogResource {
  resource?: string;
  accepts?: CatalogAccept[];
}

interface SearchResponse {
  resources?: CatalogResource[];
}

/** A candidate that survived filtering, with the option that made it payable. */
export interface Candidate {
  url: string;
  amount: bigint;
  asset: string;
}

export interface PayAndCallResult extends PayResult {
  /** The URL that was selected and paid. */
  selectedUrl: string;
  /** The query that produced it. */
  query: string;
  /** Total catalog entries the search returned. */
  resultsFound: number;
  /** How many were payable by this server AND under the ceiling. */
  resultsPayable: number;
}

/** Raised when no result qualifies. Carries the cheapest price seen, if any. */
export class NoPayableResultError extends Error {
  readonly cheapestAmount?: bigint;
  readonly cheapestAsset?: string;
  readonly resultsFound: number;

  constructor(
    message: string,
    opts: { resultsFound: number; cheapestAmount?: bigint; cheapestAsset?: string },
  ) {
    super(message);
    this.name = "NoPayableResultError";
    this.resultsFound = opts.resultsFound;
    if (opts.cheapestAmount !== undefined) this.cheapestAmount = opts.cheapestAmount;
    if (opts.cheapestAsset !== undefined) this.cheapestAsset = opts.cheapestAsset;
  }
}

/**
 * Filter a search response to what this server could actually pay, cheapest
 * first.
 *
 * Payable means every one of: an `accepts` entry on the configured network,
 * scheme `exact`, an asset on this server's allowlist, and fees explicitly
 * sponsored. `areFeesSponsored` is required rather than assumed — without it
 * the payer needs XLM of its own, which is the difference between a resource a
 * zero-XLM account can pay and one it cannot.
 *
 * Exported for testing.
 */
export function selectCandidates(
  data: SearchResponse,
  config: Pick<PayerConfig, "caip2" | "allowedAssets">,
): { payable: Candidate[]; resultsFound: number } {
  const resources = data.resources ?? [];
  const payable: Candidate[] = [];

  for (const r of resources) {
    const url = r.resource;
    if (!url) continue;

    for (const a of r.accepts ?? []) {
      if (a.network !== config.caip2) continue;
      if (a.scheme !== "exact") continue;
      if (!a.asset || !config.allowedAssets.includes(a.asset)) continue;
      if (a.extra?.areFeesSponsored !== true) continue;
      if (a.amount === undefined) continue;

      let amount: bigint;
      try {
        amount = BigInt(a.amount);
      } catch {
        // A non-integer amount is a malformed entry, not a free resource.
        continue;
      }
      if (amount < 0n) continue;

      payable.push({ url, amount, asset: a.asset });
      break; // one option per resource is enough
    }
  }

  payable.sort((x, y) => (x.amount < y.amount ? -1 : x.amount > y.amount ? 1 : 0));
  return { payable, resultsFound: resources.length };
}

export interface PayAndCallDeps {
  payer: Payer;
  config: PayerConfig;
  ledger: SpendLedger;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Overrides VELLAR_X402_FACILITATOR_URL. */
  facilitatorUrl?: string;
}

/**
 * Search the Bazaar, select the cheapest payable result under `maxAmount`, and
 * pay it.
 *
 * Throws rather than returning a partial result. Every throw happens BEFORE
 * anything is signed, except a failure inside `payer.pay`, which carries its
 * own settled/unsettled distinction.
 */
export async function payAndCall(
  deps: PayAndCallDeps,
  query: string,
  maxAmount: string,
): Promise<PayAndCallResult> {
  const { payer, config, ledger } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.facilitatorUrl ?? process.env.VELLAR_X402_FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL;

  if (!/^\d+$/.test(maxAmount)) {
    throw new Error("max_amount must be a non-negative integer in the asset's base units");
  }
  const ceiling = BigInt(maxAmount);

  // The session ceiling is checked FIRST, before any network call. A call that
  // could not pay anything must not reach the facilitator, and must not tell
  // the model about resources it was never able to buy.
  //
  // Checked per allowed asset: base units are only comparable within one asset,
  // so there is no single number to compare against. If no asset has room for
  // even the smallest possible spend, nothing here can succeed.
  const anyRoom = config.allowedAssets.some((asset) => ledger.remainingFor(asset) > 0n);
  if (!anyRoom) {
    throw new Error(
      "session ceiling exhausted for every allowed asset. This limit is set at startup and " +
        "cannot be raised by a tool call.",
    );
  }

  const url = new URL("/discovery/search", base);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(SEARCH_LIMIT));

  let data: SearchResponse;
  try {
    const res = await fetchImpl(url.toString());
    if (!res.ok) {
      throw new Error(`the Bazaar returned HTTP ${res.status}`);
    }
    data = (await res.json()) as SearchResponse;
  } catch (err) {
    // The hosted facilitator sleeps after 15 minutes idle and the first request
    // then takes roughly 45 seconds. Saying so turns a retry into an informed
    // decision rather than a guess.
    throw new Error(
      `could not reach the Bazaar at ${base}: ${err instanceof Error ? err.message : String(err)}. ` +
        "If this is the hosted instance it may be cold-starting, which takes roughly 45 seconds; " +
        "retry once before concluding it is down.",
    );
  }

  const { payable, resultsFound } = selectCandidates(data, config);

  if (payable.length === 0) {
    throw new NoPayableResultError(
      `no result is payable by this server. ${resultsFound} result(s) were found, but none ` +
        "offered an 'exact' option on the configured network in an allowed asset with " +
        "sponsored fees.",
      { resultsFound },
    );
  }

  const affordable = payable.filter((c) => c.amount <= ceiling);
  if (affordable.length === 0) {
    // Naming the cheapest price is the whole point of this branch: the agent
    // can then ask the user for that specific amount rather than guessing.
    const cheapest = payable[0] as Candidate;
    throw new NoPayableResultError(
      `nothing is under max_amount ${ceiling}. The cheapest payable result costs ` +
        `${cheapest.amount} base units of ${cheapest.asset}. Nothing was signed and nothing ` +
        "was spent.",
      { resultsFound, cheapestAmount: cheapest.amount, cheapestAsset: cheapest.asset },
    );
  }

  const chosen = affordable[0] as Candidate;
  log("info", "pay_and_call selected", {
    query,
    url: chosen.url,
    amount: chosen.amount.toString(),
    resultsFound,
    resultsPayable: affordable.length,
  });

  // Delegate to the existing payer: it re-quotes the URL, re-checks the price,
  // the asset, the network and the session ceiling, and serialises payments.
  // Nothing here is trusted as a substitute for those checks — the catalog is
  // seller-supplied data and its price is a claim until the 402 confirms it.
  const result = await payer.pay(chosen.url, maxAmount);

  return {
    ...result,
    selectedUrl: chosen.url,
    query,
    resultsFound,
    resultsPayable: affordable.length,
  };
}
