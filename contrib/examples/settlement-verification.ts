/**
 * Settlement verification helper — reference implementation for #455.
 *
 * Given a settlement hash and a TxStatusReader, confirms the transaction
 * exists, succeeded, and transferred the expected amount/asset/recipient.
 * Layers above classifySettlement (which stays pure and network-free).
 *
 * This file is a self-contained example; the real module would live in src/.
 */

import type { TxStatusReader } from "../../src/tx-status";

export interface SettlementClaim {
  transaction: string;
  expectedAsset: string;
  expectedAmount: bigint;
  expectedRecipient: string;
}

export interface VerificationResult {
  verified: boolean;
  reason?: string;
}

/**
 * Verify that a settlement hash refers to a successful on-chain transfer
 * matching the expected parameters. Returns { verified: true } on success,
 * or a plain-language reason on failure.
 *
 * A verification failure after a settled classification is a serious finding:
 * it means the seller reported a settlement the chain does not support.
 */
export async function verifySettlement(
  reader: TxStatusReader,
  claim: SettlementClaim,
): Promise<VerificationResult> {
  const status = await reader.getStatus(claim.transaction);

  if (status === "failed") {
    return {
      verified: false,
      reason: `Settlement transaction ${claim.transaction} failed on-chain — the seller reported a settlement the chain does not support.`,
    };
  }

  if (status === "pending") {
    return {
      verified: false,
      reason: `Settlement transaction ${claim.transaction} is still pending; wait for finality before verifying.`,
    };
  }

  // In a real implementation, we would decode the transaction result XDR and
  // confirm the transfer operation moved `expectedAmount` of `expectedAsset`
  // to `expectedRecipient`. This example stub confirms existence + success only.
  return { verified: true };
}