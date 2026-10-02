import { classifySettlement, type SettlementOutcome } from "../../src/x402-guards";

/**
 * Standard exit codes for CLI payment settlement retry semantics (#412).
 * - SETTLED (0): Payment settled on-chain. Safe to complete.
 * - NOT_SPENT (3): Refused or failed before submission. Safe to retry immediately.
 * - INDETERMINATE (5): Uncertain status or post-submission failure.
 *   DO NOT blindly retry without checking the chain first.
 */
export const CLI_PAY_SETTLEMENT_EXIT_CODES = {
  SETTLED: 0,
  NOT_SPENT: 3,
  INDETERMINATE: 5,
} as const;

export interface SettlementHandlingResult {
  exitCode: number;
  outcome: SettlementOutcome;
  guidance?: string;
  output?: string;
}

/**
 * Evaluates a payment response using classifySettlement, applies standard exit codes,
 * and generates operator guidance if the payment status is indeterminate (#412).
 */
export function handleSettlementOutcome(
  outcome: SettlementOutcome,
  content?: string,
): SettlementHandlingResult {
  switch (outcome.kind) {
    case "settled": {
      return {
        exitCode: CLI_PAY_SETTLEMENT_EXIT_CODES.SETTLED,
        outcome,
        output: content,
      };
    }

    case "not-spent": {
      return {
        exitCode: CLI_PAY_SETTLEMENT_EXIT_CODES.NOT_SPENT,
        outcome,
        guidance: `Payment was not spent (${outcome.reason}). It is safe to retry.`,
      };
    }

    case "indeterminate": {
      const tx = outcome.raw ? ` (tx: ${outcome.raw})` : "";
      return {
        exitCode: CLI_PAY_SETTLEMENT_EXIT_CODES.INDETERMINATE,
        outcome,
        guidance:
          `Payment settlement is indeterminate (${outcome.reason})${tx}. ` +
          `A transaction may have been submitted to the network. ` +
          `Inspect the transaction on Horizon or Stellar Expert before retrying to prevent double-spending.`,
      };
    }
  }
}

/**
 * Helper to process a Response directly through classification and guidance handling (#412).
 */
export async function processPayResponse(
  res: Response,
  options: { readBody?: boolean } = { readBody: true },
): Promise<SettlementHandlingResult> {
  const outcome = classifySettlement(res);
  const content = options.readBody ? await res.text() : undefined;
  return handleSettlementOutcome(outcome, content);
}
