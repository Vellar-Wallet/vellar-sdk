import { Command } from "commander";

export const DEFAULT_FACILITATOR_URL = "https://vellar-facilitator.onrender.com";

/** One entry of `accepts[]` on a catalog resource. */
interface Accept {
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
}

/** A catalog entry as returned by `GET /discovery/search`. */
interface CatalogResource {
  resource?: string;
  serviceName?: string;
  description?: string;
  accepts?: Accept[];
  trust?: { settlements?: number; uniquePayers?: number };
}

/**
 * Render one catalog entry. Everything except the `trust` block is text the
 * seller supplied, so it is printed as a claim rather than as fact, and the
 * description is clamped: the catalog already bounds it at 256 characters, but
 * a terminal should not be at the mercy of that promise.
 */
function renderResource(r: CatalogResource): string {
  const lines: string[] = [];
  lines.push(r.resource ?? "(no resource URL)");
  if (r.serviceName) lines.push(`  ${r.serviceName}`);

  // The price lives in accepts[], not at the top level: one entry per scheme
  // and network the seller will take.
  for (const a of r.accepts ?? []) {
    const scheme = a.scheme ?? "unknown";
    const network = a.network ?? "unknown";
    lines.push(`  ${scheme} on ${network}: ${a.amount ?? "?"} base units of ${a.asset ?? "?"}`);
  }

  if (r.description) {
    const d = r.description.length > 200 ? `${r.description.slice(0, 200)}...` : r.description;
    lines.push(`  ${d}`);
  }

  // settlements and uniquePayers are counted from observed on-chain activity,
  // so they are the only fields here a seller cannot write.
  const t = r.trust;
  if (t && (t.settlements !== undefined || t.uniquePayers !== undefined)) {
    lines.push(`  trust: ${t.settlements ?? 0} settlements, ${t.uniquePayers ?? 0} unique payers`);
  }
  return lines.join("\n");
}

export function makeSearchCommand(): Command {
  return new Command("search")
    .description("Search the Vellar Bazaar for payable resources")
    .argument("<query>", "Natural language search query")
    .option(
      "--facilitator <url>",
      "Facilitator URL",
      process.env.VELLAR_FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL,
    )
    .option("--limit <n>", "Maximum results", "10")
    .option("--json", "Output raw JSON")
    .action(async (query: string, opts: { facilitator: string; limit: string; json?: boolean }) => {
      try {
        const url = new URL("/discovery/search", opts.facilitator);
        // The endpoint takes `query`, not `q`. A wrong key is not an error:
        // it returns an unfiltered listing, which looks like a working search.
        url.searchParams.set("query", query);
        url.searchParams.set("limit", opts.limit);

        const res = await fetch(url.toString());
        if (!res.ok) {
          console.error(`Search failed: ${res.status} ${res.statusText}`);
          process.exit(1);
        }

        const data = (await res.json()) as { resources?: CatalogResource[]; partialResults?: boolean };
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        const results = data.resources ?? [];
        if (results.length === 0) {
          console.log("No results found.");
          return;
        }

        for (const r of results) {
          console.log("");
          console.log(renderResource(r));
        }

        // A Voyage outage drops the semantic arm silently, so say it rather
        // than letting a degraded ranking look like a complete one.
        if (data.partialResults) {
          console.log("");
          console.log("Note: partial results. Part of the search pipeline was unavailable.");
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
