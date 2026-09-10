import { Command } from "commander";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";

/**
 * One payment option from a 402 challenge. Aliased from the library type so
 * this CLI cannot drift from what `@x402/core` actually accepts.
 */
export type Requirement = PaymentRequirements;
export type { PaymentRequired };

/**
 * Decode the 402 challenge. x402 v2 carries it in the `PAYMENT-REQUIRED`
 * header as base64 JSON; some servers also mirror it in the body. Header wins,
 * body is the fallback, and a failure to parse either is reported rather than
 * being silently treated as "no payment required".
 */
export function decodeChallenge(header: string | null, body: string): PaymentRequired | null {
  if (header) {
    try {
      return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentRequired;
    } catch {
      // Not base64, or not JSON. Some servers send the JSON unencoded.
      try {
        return JSON.parse(header) as PaymentRequired;
      } catch {
        /* fall through to the body */
      }
    }
  }
  try {
    return JSON.parse(body) as PaymentRequired;
  } catch {
    return null;
  }
}

export function makeQuoteCommand(): Command {
  return new Command("quote")
    .description("Check the price of a resource without paying")
    .argument("<url>", "Resource URL to quote")
    .option("--json", "Output raw JSON")
    .action(async (url: string, opts: { json?: boolean }) => {
      try {
        // GET, never HEAD: a HEAD request carries no payment challenge, so a
        // correctly wired paid route looks free.
        const res = await fetch(url, { method: "GET" });

        if (res.status !== 402) {
          if (res.ok) {
            console.log("Resource is free (no payment required).");
            return;
          }
          console.error(`Unexpected status: ${res.status} ${res.statusText}`);
          process.exit(1);
        }

        const body = await res.text();
        const challenge = decodeChallenge(res.headers.get("payment-required"), body);
        if (!challenge) {
          console.error("Got a 402 but could not decode the payment challenge.");
          process.exit(1);
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(challenge, null, 2));
          return;
        }

        console.log(`URL:    ${url}`);
        const accepts = challenge.accepts ?? [];
        if (accepts.length === 0) {
          console.log("The 402 carried no payment options.");
          return;
        }

        // Every option is printed. A seller may advertise more than one scheme,
        // and picking one for the reader would hide the choice.
        for (const [i, a] of accepts.entries()) {
          if (accepts.length > 1) console.log(`\nOption ${i + 1}:`);
          console.log(`Scheme: ${a.scheme ?? "unknown"}`);
          console.log(`Network:${a.network ?? "unknown"}`);
          console.log(`Amount: ${a.amount ?? "unknown"} (base units)`);
          console.log(`Asset:  ${a.asset ?? "unknown"}`);
          if (a.payTo) console.log(`Pay to: ${a.payTo}`);
          // Without sponsorship the payer needs XLM of their own, which is the
          // difference between a payable resource and an unpayable one here.
          console.log(`Fees:   ${a.extra?.areFeesSponsored ? "sponsored" : "NOT sponsored"}`);
        }

        console.log("");
        console.log("No payment was made and nothing was signed by this call.");
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
