/**
 * CLI --dry-run implementation helper (#413).
 *
 * Runs the complete payment construction and signing pipeline without sending
 * the payment signature header over the network. Outputs dry run payload info
 * and explicitly documents server-side verification disclaimer.
 */
export interface DryRunOptions {
  dryRun?: boolean;
  json?: boolean;
  payerPublicKey: string;
  asset: string;
  amount: bigint;
  payTo: string;
  payload: unknown;
  paymentHeader: Record<string, string>;
}

export interface DryRunResult {
  isDryRun: boolean;
  payer: string;
  asset: string;
  amount: string;
  payTo: string;
  expirationLedger: string;
  disclaimer: string;
  sentNetworkRequest: boolean;
}

export function executeCliDryRun(opts: DryRunOptions): DryRunResult | null {
  if (!opts.dryRun) {
    return null;
  }

  const expirationLedger = String(
    (opts.payload as any)?.expirationLedger ??
      (opts.payload as any)?.validUntil ??
      (opts.payload as any)?.maxTimeoutSeconds ??
      "unknown",
  );

  const disclaimer =
    "Verification happens server-side; this dry-run does NOT prove the facilitator will accept the payment.";

  const result: DryRunResult = {
    isDryRun: true,
    payer: opts.payerPublicKey,
    asset: opts.asset,
    amount: opts.amount.toString(),
    payTo: opts.payTo,
    expirationLedger,
    disclaimer,
    sentNetworkRequest: false,
  };

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ...result,
          paymentHeader: opts.paymentHeader,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("DRY RUN: Payment constructed and signed successfully.");
    console.error(`Payer:             ${opts.payerPublicKey}`);
    console.error(`Asset:             ${opts.asset}`);
    console.error(`Amount:            ${opts.amount} base units`);
    console.error(`Recipient (payTo): ${opts.payTo}`);
    console.error(`Expiration Ledger: ${expirationLedger}`);
    console.error(`Note: ${disclaimer}`);
  }

  return result;
}
