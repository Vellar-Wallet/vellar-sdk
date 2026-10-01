// Request timeout bounding for MCP payer (#417).
//
// Outbound resource requests to untrusted sellers must be bounded with a
// timeout to prevent hanging connections from deadlocking the agent.
//
// 25 seconds is justified against MIN_VIABLE_EXPIRATION_LEDGERS = 5 in
// smart-account-scheme.ts (~25s on Stellar, absorbing ~2x measured worst-case settlement
// latency of ~12-15s / 2-3 ledgers).

/**
 * Default timeout in milliseconds for outbound HTTP requests made by the payer.
 * 25 seconds aligns with ~5 Stellar ledgers, accommodating worst-case settlement latency.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;

export class IndeterminateSettlementError extends Error {
  constructor(
    message: string,
    readonly asset?: string,
    readonly amount?: bigint,
  ) {
    super(message);
    this.name = "IndeterminateSettlementError";
  }
}

export function parseRequestTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_REQUEST_TIMEOUT_MS;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `VELLAR_X402_REQUEST_TIMEOUT_MS must be a positive integer, got ${JSON.stringify(trimmed)}.`,
    );
  }
  const value = Number(trimmed);
  if (value <= 0) {
    throw new Error("VELLAR_X402_REQUEST_TIMEOUT_MS must be greater than 0.");
  }
  return value;
}

export function isTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return true;
    }
    const message = err.message.toLowerCase();
    if (
      message.includes("timed out") ||
      message.includes("timeout") ||
      message.includes("abort")
    ) {
      return true;
    }
  }
  return false;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  try {
    const res = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof Error) throw reason;
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface SpendLedgerLike {
  assertWithinCeiling(asset: string, amount: bigint): void;
  debit(asset: string, amount: bigint): void;
}

/**
 * Handle a payment retry request with timeout protection.
 * If the paid retry times out, it debits the ledger and throws IndeterminateSettlementError.
 */
export async function executePaidRetryWithTimeout(
  url: string,
  init: RequestInit,
  asset: string,
  amount: bigint,
  ledger: SpendLedgerLike,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init, timeoutMs, fetchImpl);
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      // V-2: Debit ledger on paid retry timeout because the transaction may have settled on-chain.
      ledger.debit(asset, amount);
      throw new IndeterminateSettlementError(
        `Request timed out after ${timeoutMs}ms while awaiting settlement confirmation from ${url}. ` +
          "The payment may have completed on-chain; ledger has been debited.",
        asset,
        amount,
      );
    }
    throw err;
  }
}
