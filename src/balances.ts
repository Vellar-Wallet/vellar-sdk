// Account state helpers (technical-doc.md §5.2: view balances and account
// metadata). Smart accounts are contract addresses, so balances come from
// token-contract reads (SAC `balance(id)`), never Horizon /accounts. This
// module is dependency-free; the RPC-backed reader lives in balances-rpc.ts.

export interface TokenInfo {
  symbol: string;
  /** Token (SAC or custom) contract id the balance is read from. */
  contractId: string;
  decimals: number;
}

export interface TokenBalance extends TokenInfo {
  /** Raw units (e.g. stroops for XLM). */
  amount: bigint;
}

export interface BalanceReader {
  getTokenBalance(tokenContractId: string, holder: string): Promise<bigint>;
  /**
   * Optional bulk read. When a reader implements this, the service collapses N
   * per-token calls into it instead of issuing one request each (issue #216).
   * Must resolve in the same order as `tokenContractIds`.
   */
  getTokenBalances?(tokenContractIds: string[], holder: string): Promise<bigint[]>;
}

export interface BalanceService {
  getBalances(holder: string): Promise<TokenBalance[]>;
  /** Fetch balances for many assets in one call; partial failures are per-item. */
  getBalancesBatch(holder: string, tokens: TokenInfo[]): Promise<BatchBalanceResult[]>;
}

/** Maximum number of assets in a single batch balance request. */
export const MAX_BATCH_BALANCE_SIZE = 32;

export type BatchBalanceResult =
  | { contractId: string; success: true; amount: bigint }
  | { contractId: string; success: false; error: string };

export class BatchBalanceSizeError extends Error {
  constructor(
    readonly maxSize: number,
    readonly requested: number,
  ) {
    super(`batch balance request exceeds max size of ${maxSize}, got ${requested}`);
    this.name = "BatchBalanceSizeError";
  }
}

export function createBalanceService(reader: BalanceReader, tokens: TokenInfo[]): BalanceService {
  return {
    async getBalances(holder) {
      if (reader.getTokenBalances) {
        const amounts = await reader.getTokenBalances(
          tokens.map((t) => t.contractId),
          holder,
        );
        return tokens.map((token, i) => ({ ...token, amount: amounts[i]! }));
      }
      return Promise.all(
        tokens.map(async (token) => ({
          ...token,
          amount: await reader.getTokenBalance(token.contractId, holder),
        })),
      );
    },
    getBalancesBatch(holder, batchTokens) {
      return fetchBalancesBatch(reader, holder, batchTokens);
    },
  };
}

export async function fetchBalancesBatch(
  reader: BalanceReader,
  holder: string,
  tokens: Pick<TokenInfo, "contractId">[],
): Promise<BatchBalanceResult[]> {
  if (tokens.length > MAX_BATCH_BALANCE_SIZE) {
    throw new BatchBalanceSizeError(MAX_BATCH_BALANCE_SIZE, tokens.length);
  }
  // Prefer the bulk read (one RPC round trip) when the reader supports it. A
  // bulk failure degrades to per-token reads so per-item error isolation — the
  // documented contract of this function — is preserved.
  if (reader.getTokenBalances) {
    try {
      const amounts = await reader.getTokenBalances(
        tokens.map((t) => t.contractId),
        holder,
      );
      if (amounts.length === tokens.length) {
        return tokens.map(({ contractId }, i) => ({
          contractId,
          success: true as const,
          amount: amounts[i]!,
        }));
      }
    } catch {
      // fall through to the per-token path
    }
  }
  return Promise.all(
    tokens.map(async ({ contractId }) => {
      try {
        const amount = await reader.getTokenBalance(contractId, holder);
        return { contractId, success: true as const, amount };
      } catch (err) {
        return {
          contractId,
          success: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

/**
 * Formats raw token units as a decimal string: no rounding, trailing zeros
 * trimmed ("100000000000", 7 -> "10000"; "10000001", 7 -> "1.0000001").
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
