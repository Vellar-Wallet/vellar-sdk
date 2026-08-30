/**
 * Advisory helper that checks a proposed `maxAmount` against a mock price feed
 * and returns a warning when the implied fiat value looks unreasonably high.
 *
 * This is NOT enforcement — it is a heuristic for UI/UX guidance.
 */

export interface PriceFeed {
  [assetCode: string]: number; // asset code → reference fiat rate per 1 unit
}

export interface ValidationResult {
  /** True when the amount exceeds the warning threshold. */
  warned: boolean;
  /** Human-readable warning message, or undefined if no warning. */
  message?: string;
}

const DEFAULT_PRICE_FEED: PriceFeed = {
  USDC: 1.0,
  ETH: 3000.0,
  BTC: 60000.0,
  XLM: 0.12,
  // Custom asset example
  CUSTOM_ASSET: 42.0,
};

/**
 * Validate a maxAmount (in base units of the asset) against a hardcoded price
 * feed. Uses a simple threshold: warn if the implied fiat value is above a
 * very high hardcoded cap (e.g. $1,000,000) for the asset.
 */
export function validateMaxAmount(options: {
  asset: string;
  amount: bigint;
  /** Optional override price feed. */
  priceFeed?: PriceFeed;
  /** Warning threshold in fiat units (e.g. USD). Default: 1_000_000. */
  warningThreshold?: number;
  /** Decimals to interpret the base unit amount. Default: 7. */
  assetDecimals?: number;
}): ValidationResult {
  const {
    asset,
    amount,
    priceFeed = DEFAULT_PRICE_FEED,
    warningThreshold = 1_000_000,
    assetDecimals = 7,
  } = options;

  const unitPrice = priceFeed[asset];
  if (unitPrice === undefined) {
    return {
      warned: false,
      message: `No price feed available for ${asset}; cannot validate.`,
    };
  }

  const amountNum = Number(amount) / Math.pow(10, assetDecimals);
  const fiatValue = amountNum * unitPrice;

  if (fiatValue > warningThreshold) {
    return {
      warned: true,
      message: `maxAmount implies ~$${fiatValue.toFixed(2)} USD, which is unusually high (asset=${asset}).`,
    };
  }

  return { warned: false };
}