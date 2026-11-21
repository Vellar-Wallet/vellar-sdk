/**
 * Worked example: watch a facilitator sponsor account from a monitoring script
 * and keep it above the soft floor (#843).
 *
 *   SPONSOR_ADDRESS=G... HORIZON_URL=https://horizon.stellar.org \
 *     npx tsx contrib/issue-843/example.ts
 *
 * By default this only READS the balance and LOGS an alert. Funding is a
 * sensitive on-chain action and stays off unless you opt in explicitly:
 *
 *   --execute                   enable funding (otherwise it is a dry run)
 *   FUNDER_SECRET=S...          secret key of the account that pays the top-up
 *   MAX_TOP_UP_XLM=50           hard cap on a single top-up (required)
 *
 * Use a dedicated, low-balance funder account, never a treasury key.
 */

import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  monitorSponsor,
  xlmToStroops,
  type SponsorEvent,
  type SponsorMonitorDeps,
} from "./sponsor-monitor";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const stroopsToXlm = (stroops: bigint): string =>
  `${stroops / 10_000_000n}.${(stroops % 10_000_000n).toString().padStart(7, "0")}`;

function log(event: SponsorEvent): void {
  const when = new Date().toISOString();
  switch (event.kind) {
    case "soft-floor-crossed":
      console.warn(`${when} ALERT sponsor ${event.state}: ${stroopsToXlm(event.balanceStroops)} XLM`);
      break;
    case "recovered":
      console.info(`${when} sponsor recovered: ${stroopsToXlm(event.balanceStroops)} XLM`);
      break;
    case "funded":
      console.info(`${when} topped up ${stroopsToXlm(event.amountStroops)} XLM (tx ${event.txHash})`);
      break;
    case "fund-skipped":
      console.warn(`${when} funding skipped: ${event.reason}`);
      break;
    case "fund-failed":
      console.error(`${when} funding failed: ${event.error}`);
      break;
    case "check-failed":
      console.error(`${when} balance check failed: ${event.error}`);
      break;
  }
}

async function main(): Promise<void> {
  const sponsorAddress = required("SPONSOR_ADDRESS");
  const horizonUrl = process.env.HORIZON_URL ?? "https://horizon.stellar.org";
  const server = new Horizon.Server(horizonUrl);
  const execute = process.argv.includes("--execute");

  const deps: SponsorMonitorDeps = {
    notify: log,
    getBalanceStroops: async () => {
      const account = await server.loadAccount(sponsorAddress);
      const native = account.balances.find((b) => b.asset_type === "native");
      if (!native) throw new Error("sponsor account has no native balance");
      return xlmToStroops(native.balance);
    },
  };

  let maxTopUpStroops: bigint | undefined;
  if (execute) {
    const funder = Keypair.fromSecret(required("FUNDER_SECRET"));
    maxTopUpStroops = xlmToStroops(required("MAX_TOP_UP_XLM"));
    deps.fund = async (amountStroops) => {
      const source = await server.loadAccount(funder.publicKey());
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: horizonUrl.includes("testnet") ? Networks.TESTNET : Networks.PUBLIC,
      })
        .addOperation(
          Operation.payment({
            destination: sponsorAddress,
            asset: Asset.native(),
            amount: stroopsToXlm(amountStroops),
          }),
        )
        .setTimeout(60)
        .build();
      tx.sign(funder);
      const result = await server.submitTransaction(tx);
      return result.hash;
    };
  } else {
    console.info("Dry run: alerts only. Pass --execute to enable funding.");
  }

  const abort = new AbortController();
  process.on("SIGINT", () => abort.abort());
  await monitorSponsor(deps, { autoFund: execute, maxTopUpStroops, signal: abort.signal });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
