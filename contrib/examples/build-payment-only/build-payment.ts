// Example: build (and simulate) a payment transaction using the real
// payments client, print the built XDR, and stop — the transaction is never
// signed or submitted.
//
// Run with: npx tsx build-payment.ts <to> <amount> <tokenContractId>
// Example:  npx tsx build-payment.ts GRECIPIENT... 10.5 CTOKENCONTRACT...

import { createPaymentClient, type SacClientLike } from "../../../src/payments-client";
import { parseTokenAmount } from "../../../src/payments";
import type { TokenInfo } from "../../../src/balances";

interface BuiltTx {
  toXDR(): string;
}

/**
 * A mock SAC client: "builds" a transfer by returning an object with a
 * toXDR() method (the same shape the real SAC client's AssembledTransaction
 * exposes), and remembers the last one built so the caller can inspect it —
 * preparePayment()'s public API only exposes `review` and `confirm()`, not
 * the built tx itself.
 */
export function createMockSacClient(): {
  sac: SacClientLike;
  getLastBuilt: () => BuiltTx | undefined;
} {
  let lastBuilt: BuiltTx | undefined;
  const sac: SacClientLike = {
    getSACClient(tokenContractId: string) {
      return {
        async transfer(args: { from: string; to: string; amount: bigint }) {
          const tx: BuiltTx = {
            toXDR: () =>
              `MOCKXDR(contract=${tokenContractId},from=${args.from},to=${args.to},amount=${args.amount})`,
          };
          lastBuilt = tx;
          return tx;
        },
      };
    },
  };
  return { sac, getLastBuilt: () => lastBuilt };
}

export async function main() {
  const [to, amountArg, tokenContractId] = process.argv.slice(2);
  if (!to || !amountArg || !tokenContractId) {
    console.error("Usage: npx tsx build-payment.ts <to> <amount> <tokenContractId>");
    process.exitCode = 1;
    return;
  }

  // A sample sender — a real app would use wallet.session.accountId, not a CLI arg.
  const from = "CFROMSAMPLESENDERWALLETADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXX";
  const token: TokenInfo = { symbol: "TOKEN", contractId: tokenContractId, decimals: 7 };

  let amount: bigint;
  try {
    amount = parseTokenAmount(amountArg, token.decimals);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const { sac, getLastBuilt } = createMockSacClient();
  const paymentClient = createPaymentClient({
    kit: { sign: async (tx: unknown) => tx },
    sac,
    backend: {
      async submitTransaction() {
        throw new Error("submitTransaction should never be called — this example never confirms");
      },
    },
    network: "testnet",
    isValidAddress: () => true,
  });

  const prepared = await paymentClient.preparePayment({ from, to, token, amount });

  console.log("Built payment (simulated during build; NOT signed or submitted):");
  console.log("  XDR:   ", getLastBuilt()?.toXDR());
  console.log("  Review:", prepared.review);
  console.log();
  console.log("This script deliberately never calls prepared.confirm() — no signature, no submission.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
