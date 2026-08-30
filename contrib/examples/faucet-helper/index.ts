/**
 * Helper to request testnet funds from the public friendbot faucet.
 *
 * Throws on non-200 responses with the faucet's error message.
 */

const FRIENDBOT_BASE = "https://friendbot.stellar.org";

export interface FaucetResult {
  funded: boolean;
}

export interface FaucetOptions {
  /** Friendbot base URL. Default: https://friendbot.stellar.org */
  baseUrl?: string;
  /** Additional query params forwarded to friendbot (e.g. `{ asset: "USDC:..." }`). */
  params?: Record<string, string>;
}

export class FaucetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaucetError";
  }
}

export async function requestTestnetFunds(accountId: string, opts?: FaucetOptions): Promise<FaucetResult> {
  const baseUrl = opts?.baseUrl ?? FRIENDBOT_BASE;
  const url = new URL(baseUrl);
  url.searchParams.set("addr", accountId);
  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    throw new FaucetError(err instanceof Error ? err.message : "network request failed");
  }

  if (!res.ok) {
    let message = `Faucet request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string; error?: string };
      message = body.detail ?? body.error ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new FaucetError(message);
  }

  // Best-effort parse: friendbot returns the funded account on success.
  try {
    const data = (await res.json()) as { account_id?: string };
    if (!data.account_id) throw new Error("missing account_id");
  } catch {
    // If parsing fails, still treat 200 as success per friendbot behavior.
  }

  return { funded: true };
}