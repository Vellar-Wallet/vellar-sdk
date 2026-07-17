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
}

export interface BalanceService {
  getBalances(holder: string): Promise<TokenBalance[]>;
}

export function createBalanceService(reader: BalanceReader, tokens: TokenInfo[]): BalanceService {
  return {
    async getBalances(holder) {
      return Promise.all(
        tokens.map(async (token) => ({
          ...token,
          amount: await reader.getTokenBalance(token.contractId, holder),
        })),
      );
    },
  };
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
