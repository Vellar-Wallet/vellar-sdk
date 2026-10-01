export interface ExpirationOptions {
  /** Estimated network ledger close time in seconds. */
  ledgerSecondsEstimate?: number;
  /** Safety margin kept below the facilitator's maximum ledger. */
  safetyMarginLedgers?: number;
  /** Smallest usable signature window. */
  minExpirationLedgers?: number;
  /** Maximum signature window, preventing unbounded seller timeouts. */
  maxExpirationLedgers?: number;
}

const DEFAULT_LEDGER_SECONDS = 5;
const DEFAULT_SAFETY_MARGIN = 2;
const DEFAULT_MIN_LEDGERS = 3;
const DEFAULT_MAX_LEDGERS = 58;

/**
 * Convert a seller timeout into a bounded signature-expiration offset.
 * Defaults are measured/documented in README.md; callers on a different network
 * can override its close-time estimate without patching the SDK.
 */
export function expirationOffsetFor(
  maxTimeoutSeconds: number | undefined,
  options: ExpirationOptions = {},
): number {
  const ledgerSeconds = options.ledgerSecondsEstimate ?? DEFAULT_LEDGER_SECONDS;
  const safetyMargin = options.safetyMarginLedgers ?? DEFAULT_SAFETY_MARGIN;
  const minimum = options.minExpirationLedgers ?? DEFAULT_MIN_LEDGERS;
  const maximum = options.maxExpirationLedgers ?? DEFAULT_MAX_LEDGERS;

  if (!Number.isFinite(ledgerSeconds) || ledgerSeconds <= 0) {
    throw new RangeError("ledgerSecondsEstimate must be finite and greater than zero");
  }
  if (!Number.isSafeInteger(safetyMargin) || safetyMargin < 0) {
    throw new RangeError("safetyMarginLedgers must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(minimum) || minimum < 1) {
    throw new RangeError("minExpirationLedgers must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maximum) || maximum < minimum) {
    throw new RangeError("maxExpirationLedgers must be a safe integer >= minExpirationLedgers");
  }
  if (maxTimeoutSeconds !== undefined && (!Number.isFinite(maxTimeoutSeconds) || maxTimeoutSeconds < 0)) {
    throw new RangeError("maxTimeoutSeconds must be finite and non-negative");
  }

  const timeoutLedgers = Math.ceil((maxTimeoutSeconds ?? 120) / ledgerSeconds);
  const bounded = Math.min(timeoutLedgers - safetyMargin, maximum);
  return Math.max(bounded, minimum);
}