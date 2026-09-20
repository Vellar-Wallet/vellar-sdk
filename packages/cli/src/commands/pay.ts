import { Command } from "commander";
import { Keypair } from "@stellar/stellar-sdk";
import type { Network } from "@x402/core/types";
import { decodeChallenge, type Requirement } from "./quote.js";

const RPC_URLS: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const NETWORK_IDS: Record<string, Network> = {
  testnet: "stellar:testnet",
  mainnet: "stellar:pubnet",
};

/**
 * Pick the requirement to pay. Only `exact` is payable from a classic keypair
 * here: `upto` needs a contract call the official client does not build, so an
 * upto-only seller is reported rather than half-attempted.
 */
export function selectRequirement(
  accepts: Requirement[],
  network: Network,
): { chosen?: Requirement; reason?: string } {
  const onNetwork = accepts.filter((a) => a.network === network);
  if (onNetwork.length === 0) {
    return { reason: `no payment option for ${network}` };
  }
  const exact = onNetwork.filter((a) => a.scheme === "exact");
  if (exact.length === 0) {
    const schemes = [...new Set(onNetwork.map((a) => a.scheme ?? "unknown"))].join(", ");
    return { reason: `no 'exact' option (seller offers: ${schemes})` };
  }
  // Cheapest allowed option, so a seller offering several cannot have the
  // dearest one picked by list order.
  const chosen = exact.reduce((lo, a) =>
    BigInt(a.amount ?? "0") < BigInt(lo.amount ?? "0") ? a : lo,
  );
  return { chosen };
}

export function makePayCommand(): Command {
  return new Command("pay")
    .description("Pay for a resource and print the content")
    .argument("<url>", "Resource URL to pay for")
    .option("--secret <key>", "Payer secret key (S...)", process.env.VELLAR_SECRET)
    .option("--secret-file <path>", "Path to a file containing the secret key")
    .option("--max <amount>", "Maximum amount to pay in base units", "10000000")
    .option("--network <network>", "testnet or mainnet", process.env.VELLAR_NETWORK ?? "testnet")
    .option("--rpc-url <url>", "Soroban RPC URL (defaults per network)")
    .option("--method <method>", "HTTP method for both the probe and paid request", "GET")
    .option("--body <json>", "JSON body to send with the paid request (default {})")
    .option("--json", "Output raw JSON")
    .action(
      async (
        url: string,
        opts: {
          secret?: string;
          secretFile?: string;
          max: string;
          network: string;
          rpcUrl?: string;
          method: string;
          body?: string;
          json?: boolean;
        },
      ) => {
        try {
          if (!RPC_URLS[opts.network]) {
            console.error(`Error: --network must be 'testnet' or 'mainnet', got '${opts.network}'`);
            process.exit(1);
          }

          // A secret on the command line lands in shell history and in the
          // process table, so --secret-file is preferred and tried first.
          let secret = opts.secret;
          if (opts.secretFile) {
            const { readFile } = await import("node:fs/promises");
            secret = (await readFile(opts.secretFile, "utf8")).trim();
          }
          if (!secret) {
            console.error(
              "Error: provide --secret-file (preferred), --secret, or the VELLAR_SECRET env var.",
            );
            process.exit(1);
            return;
          }

          let keypair: Keypair;
          try {
            keypair = Keypair.fromSecret(secret);
          } catch {
            // Never echo the value back: it is a secret even when malformed.
            console.error("Error: invalid Stellar secret key (expected an S... seed).");
            process.exit(1);
            return;
          }

          let maxAmount: bigint;
          try {
            maxAmount = BigInt(opts.max);
          } catch {
            console.error(`Error: --max must be an integer in base units, got '${opts.max}'`);
            process.exit(1);
            return;
          }

          const method = opts.method.toUpperCase();
          // GET/HEAD never carry a body: fetch throws ("Request with GET/HEAD
          // method cannot have body") if one is attached, so both requests
          // below gate on this rather than sending a body unconditionally.
          const hasBody = method !== "GET" && method !== "HEAD";

          let requestBody = "{}";
          if (opts.body !== undefined) {
            if (safeJsonParse(opts.body) === null && opts.body.trim() !== "null") {
              console.error(`Error: --body must be valid JSON, got '${opts.body}'`);
              process.exit(1);
              return;
            }
            requestBody = opts.body;
          }

          // 1. Unpaid probe, same method/body as the paid request: a POST-only
          //    endpoint has no GET route to 402 off of, so probing with a
          //    hardcoded GET would 404/405 instead of surfacing the challenge.
          const unpaid = await fetch(url, {
            method,
            ...(hasBody ? { headers: { "Content-Type": "application/json" }, body: requestBody } : {}),
          });
          if (unpaid.ok) {
            console.log(await unpaid.text());
            console.error("(No payment was required, so nothing was spent.)");
            return;
          }
          if (unpaid.status !== 402) {
            console.error(`Unexpected status: ${unpaid.status} ${unpaid.statusText}`);
            process.exit(1);
            return;
          }

          const required = decodeChallenge(
            unpaid.headers.get("payment-required"),
            await unpaid.text(),
          );
          if (!required?.accepts?.length) {
            console.error("Got a 402 but could not decode the payment challenge.");
            process.exit(1);
            return;
          }

          const networkId = NETWORK_IDS[opts.network] as Network;
          const { chosen, reason } = selectRequirement(required.accepts, networkId);
          if (!chosen) {
            console.error(`Error: ${reason}`);
            process.exit(1);
            return;
          }

          // 2. Enforce the ceiling BEFORE signing. A refusal here costs nothing
          //    and spends nothing.
          const price = BigInt(chosen.amount ?? "0");
          if (price > maxAmount) {
            console.error(
              `Refused: price ${price} exceeds --max ${maxAmount} (base units). Nothing was signed.`,
            );
            process.exit(1);
            return;
          }

          // Without sponsorship the payer needs XLM of its own for the fee.
          if (chosen.extra?.areFeesSponsored !== true) {
            console.error(
              "Refused: the seller does not advertise sponsored fees " +
                "(extra.areFeesSponsored is not true). Nothing was signed.",
            );
            process.exit(1);
            return;
          }

          // 3. Build and sign. The scheme assembles the SEP-41 transfer, signs
          //    the payer's auth entry, and sets expiry from maxTimeoutSeconds.
          //    Signatures expire in ledgers (~5s each), so a payload is signed
          //    per attempt and never cached.
          const { x402Client } = await import("@x402/core/client");
          const { x402HTTPClient } = await import("@x402/core/http");
          const { ExactStellarScheme } = await import("@x402/stellar/exact/client");
          const { createEd25519Signer } = await import("@x402/stellar");

          const signer = createEd25519Signer(secret, networkId);
          const client = new x402Client().register(
            networkId,
            new ExactStellarScheme(signer, { url: opts.rpcUrl ?? (RPC_URLS[opts.network] as string) }),
          );
          const http = new x402HTTPClient(client);

          let payload;
          try {
            payload = await client.createPaymentPayload(required);
          } catch (err) {
            console.error(
              `Could not build the payment: ${err instanceof Error ? err.message : String(err)}`,
            );
            console.error("  Common causes: no trustline to the asset, or an empty balance.");
            process.exit(1);
            return;
          }

          // 4. Retry with the payment attached, same method/body as the probe.
          const paid = await fetch(url, {
            method,
            headers: {
              ...http.encodePaymentSignatureHeader(payload),
              ...(hasBody ? { "Content-Type": "application/json" } : {}),
            },
            ...(hasBody ? { body: requestBody } : {}),
          });
          const text = await paid.text();
          // Set by the facilitator's /settle route from the bazaar onAfterSettle
          // hook's outcome (src/bazaar.ts, src/server.ts in vellar-facilitator) —
          // relayed unchanged by a seller that forwards facilitator response
          // headers. Absent if the seller doesn't relay it or the hook never ran
          // (e.g. settlement failed before reaching the success branch).
          const extensionResponses = paid.headers.get("extension-responses");

          if (paid.status !== 200) {
            if (opts.json) {
              console.log(
                JSON.stringify({ response: safeJsonParse(text), extensionResponses }, null, 2),
              );
              process.exit(1);
              return;
            }
            console.error(`Not unlocked: HTTP ${paid.status}`);
            console.error(text);
            console.error(
              "\n  Roughly one settle in three fails on testnet with an empty transaction " +
                "field.\n  An empty transaction means nothing was spent: retry, signing a " +
                "fresh payload.\n  A non-empty transaction means fees were charged: do not retry.",
            );
            process.exit(1);
            return;
          }

          const body = safeJsonParse(text);

          if (opts.json) {
            console.log(JSON.stringify({ response: body, extensionResponses }, null, 2));
            return;
          }

          const settlement = (body as { settlement?: { transaction?: string } } | null)?.settlement;
          if (settlement?.transaction) {
            console.error(`Payer:      ${keypair.publicKey()}`);
            console.error(`Paid:       ${price} base units of ${chosen.asset ?? "?"}`);
            console.error(`Settlement: ${settlement.transaction}`);
            if (extensionResponses) console.error(`Extensions: ${extensionResponses}`);
            console.error("---");
          }
          console.log(text);
        } catch (err) {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      },
    );
}
