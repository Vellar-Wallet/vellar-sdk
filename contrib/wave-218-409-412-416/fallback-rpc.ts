import { rpc } from "@stellar/stellar-sdk";
import type { TxStatus, TxStatusReader } from "../../src/tx-status";

export interface RpcTxStatusReaderOptions {
  rpcUrl: string;
  fallbackRpcUrls?: string[];
  timeoutMs?: number;
  servers?: Pick<rpc.Server, "getTransaction">[];
}

/**
 * Creates a TxStatusReader that queries the primary RPC endpoint and
 * automatically falls back to prioritized secondary endpoints on error or timeout (#218).
 */
export function createRpcTxStatusReaderWithFallback(
  options: RpcTxStatusReaderOptions,
): TxStatusReader {
  const urls = [options.rpcUrl, ...(options.fallbackRpcUrls ?? [])];
  const servers = options.servers ?? urls.map((url) => new rpc.Server(url));
  const timeoutMs = options.timeoutMs;

  return {
    async getStatus(hash: string): Promise<TxStatus> {
      let lastError: unknown;

      for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        try {
          const fetchPromise = server.getTransaction(hash);
          const res = timeoutMs != null
            ? await Promise.race([
                fetchPromise,
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error(`RPC request timed out after ${timeoutMs}ms`)), timeoutMs),
                ),
              ])
            : await fetchPromise;

          switch (res.status) {
            case rpc.Api.GetTransactionStatus.SUCCESS:
              return "success";
            case rpc.Api.GetTransactionStatus.FAILED:
              return "failed";
            default:
              return "pending";
          }
        } catch (err) {
          lastError = err;
          // Continue to next fallback endpoint
        }
      }

      throw (
        lastError ??
        new Error("All RPC endpoints failed to fetch transaction status")
      );
    },
  };
}
