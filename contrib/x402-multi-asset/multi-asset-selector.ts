// Multi-asset selection for x402 payment decisions.
//
// WHY THIS EXISTS: selectRequirements in src/x402-guards.ts picks the cheapest
// allowed option, comparing amounts with parseAmount. Amounts are only
// comparable within a single asset — the MCP payer config module states this
// explicitly as the reason its ceilings are per-asset. So when a seller offers
// the same resource priced in two different assets, the cheapest-amount
// comparison is comparing numbers that have no common unit.
//
// This module provides:
//   - An explicit preference mechanism (ordered asset preference list)
//   - A refusal when candidates span multiple assets and no preference is stated
//   - Never compares base-unit amounts across assets (correctness bug if it did)
//
// THE BUG IN THE CURRENT CODE: selectRequirements does this:
//   const usable = allowed.reduce((cheapest, a) =>
//     parseAmount(a.amount) < parseAmount(cheapest.amount) ? a : cheapest,
//   );
// When allowed candidates have different assets, this compares amounts across
// assets — e.g. 100 USDC vs 500 XLM — as if they had a common unit. The
// cheaper-looking option wins by accident of magnitude.

import type { PaymentRequired, PaymentRequirements } from "../../src/x402-types.js";
import { NoUsablePaymentOptionError } from "../../src/x402-types.js";
import { parseAmount } from "../../src/x402-guards.js";

export interface MultiAssetOptions {
  /**
   * Ordered list of preferred asset contract ids. The first asset in this list
   * that appears among the candidates is selected. Omit to refuse multi-asset
   * choices (safer than guessing).
   */
  preferredAssets?: string[];
}

/**
 * Select a payment requirement when candidates may span multiple assets.
 *
 * When all candidates share a single asset, picks the cheapest (same as the
 * current code, and correct within a single asset). When candidates span
 * multiple assets:
 *   - If `preferredAssets` is set, picks the first preferred asset among the
 *     candidates, then the cheapest within that asset.
 *   - If `preferredAssets` is not set, refuses with a clear error explaining
 *     that amounts are not comparable across assets.
 */
export function selectWithAssetPreference(
  decoded: PaymentRequired,
  opts: MultiAssetOptions,
): PaymentRequirements {
  const candidates = decoded.accepts ?? [];
  if (candidates.length === 0) {
    throw new NoUsablePaymentOptionError("No payment options offered.");
  }

  // Group candidates by asset.
  const byAsset = new Map<string, PaymentRequirements[]>();
  for (const req of candidates) {
    const list = byAsset.get(req.asset) ?? [];
    list.push(req);
    byAsset.set(req.asset, list);
  }

  const assets = [...byAsset.keys()];

  // Single-asset case: pick the cheapest within that asset (correct).
  if (assets.length === 1) {
    const list = byAsset.get(assets[0]!)!;
    return pickCheapest(list);
  }

  // Multi-asset case: need a preference to avoid comparing across assets.
  if (!opts.preferredAssets || opts.preferredAssets.length === 0) {
    throw new NoUsablePaymentOptionError(
      `Payment options span multiple assets (${assets.join(", ")}), ` +
        `and amounts are not comparable across assets. ` +
        `Pass preferredAssets to express a preference, or filter candidates ` +
        `to a single asset before calling this function.`,
    );
  }

  for (const preferred of opts.preferredAssets) {
    const list = byAsset.get(preferred);
    if (list && list.length > 0) {
      return pickCheapest(list);
    }
  }

  throw new NoUsablePaymentOptionError(
    `None of the preferred assets (${opts.preferredAssets.join(", ")}) ` +
      `are among the offered assets (${assets.join(", ")}).`,
  );
}

/**
 * Pick the cheapest requirement from a single-asset list.
 *
 * All amounts in the list share the same asset, so comparison is valid.
 */
function pickCheapest(list: PaymentRequirements[]): PaymentRequirements {
  return list.reduce((cheapest, a) =>
    parseAmount(a.amount) < parseAmount(cheapest.amount) ? a : cheapest,
  );
}