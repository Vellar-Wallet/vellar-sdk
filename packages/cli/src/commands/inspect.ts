import { Command } from "commander";
import { createCliLogger } from "../logger.js";

export const HORIZON_URLS: Record<string, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

interface HorizonTransaction {
  hash?: string;
  successful?: boolean;
  ledger?: number;
  fee_charged?: string;
  fee_account?: string;
  source_account?: string;
  created_at?: string;
}

export function makeInspectCommand(): Command {
  return new Command("inspect")
    .description("Look up a Stellar transaction by hash")
    .argument("<tx-hash>", "Transaction hash to inspect")
    .option("--network <network>", "testnet or mainnet", process.env.VELLAR_NETWORK ?? "testnet")
    .option("--json", "Output raw JSON")
    .action(async (txHash: string, opts: { network: string; json?: boolean }) => {
      const logger = createCliLogger();
      try {
        const base = HORIZON_URLS[opts.network];
        if (!base) {
          logger.error("invalid network option", { network: opts.network });
          console.error(`Error: --network must be 'testnet' or 'mainnet', got '${opts.network}'`);
          process.exit(1);
          return;
        }

        // Catch a malformed hash here rather than reporting Horizon's 404 as
        // "not found", which reads as "this payment never happened".
        if (!/^[0-9a-f]{64}$/i.test(txHash)) {
          logger.warn("malformed transaction hash", { txHash });
          console.error(
            `Error: '${txHash}' is not a transaction hash (expected 64 hex characters).`,
          );
          process.exit(1);
          return;
        }

        const lookupUrl = `${base}/transactions/${txHash}`;
        logger.debug("querying Horizon transaction endpoint", {
          network: opts.network,
          url: lookupUrl,
        });
        const res = await fetch(lookupUrl);
        if (!res.ok) {
          logger.warn("Horizon lookup non-OK response", {
            network: opts.network,
            status: res.status,
          });
          if (res.status === 404) {
            console.error(`Transaction not found on ${opts.network}: ${txHash}`);
            console.error("  A testnet hash returns 404 on mainnet Horizon and vice versa.");
          } else {
            console.error(`Horizon returned ${res.status} ${res.statusText}`);
          }
          process.exit(1);
          return;
        }

        const tx = (await res.json()) as HorizonTransaction;
        logger.info("inspected transaction", {
          hash: tx.hash ?? txHash,
          ledger: tx.ledger,
          successful: tx.successful,
        });
        if (opts.json) {
          console.log(JSON.stringify(tx, null, 2));
          return;
        }

        console.log(`Hash:       ${tx.hash ?? txHash}`);
        console.log(`Successful: ${tx.successful}`);
        console.log(`Ledger:     ${tx.ledger}`);
        console.log(`Fee:        ${tx.fee_charged} stroops`);
        console.log(`Source:     ${tx.source_account}`);
        console.log(`Fee acct:   ${tx.fee_account}`);
        console.log(`Created:    ${tx.created_at}`);

        // On a sponsored settlement these differ: source is the channel
        // account, fee_account is the facilitator's sponsor, and the buyer
        // appears in neither. That is the non-custodial property, visible here.
        if (tx.fee_account && tx.source_account && tx.fee_account !== tx.source_account) {
          console.log("");
          console.log("Fee was paid by a different account than the transaction source");
          console.log("(fee sponsorship shown on-chain, not asserted).");
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
