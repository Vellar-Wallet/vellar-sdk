import { rpc } from "@stellar/stellar-sdk";
import type { TxStatus, TxStatusReader } from "../../src/tx-status";

export interface RpcTxStatusReaderOptions {
  rpcUrl: string;
  /** Injected RPC server (for tests). Defaults to a new rpc.Server(rpcUrl). */
  server?: Pick<rpc.Server, "getTransaction">;
  /** Warning sink; defaults to console.warn. */
  warn?: (message: string) => void;
}

/**
 * Drop-in replacement for `createRpcTxStatusReader` in src/tx-rpc.ts that
 * flags unrecognized statuses instead of silently folding them into pending.
 */
export function createRpcTxStatusReader(options: RpcTxStatusReaderOptions): TxStatusReader {
  const server = options.server ?? new rpc.Server(options.rpcUrl);
  const warn = options.warn ?? ((m: string) => console.warn(m));
  return {
    async getStatus(hash): Promise<TxStatus> {
      const res = await server.getTransaction(hash);
      switch (res.status) {
        case rpc.Api.GetTransactionStatus.SUCCESS:
          return "success";
        case rpc.Api.GetTransactionStatus.FAILED:
          return "failed";
        case rpc.Api.GetTransactionStatus.NOT_FOUND:
          // Not yet included in a ledger.
          return "pending";
        default:
          // A status this SDK does not know (e.g. added by a newer Soroban
          // RPC). Decision: warn and report "pending" rather than throw. Only
          // SUCCESS and FAILED are final, so an unknown value can never be
          // misread as success; waitForTransaction keeps polling and ends in
          // TransactionTimeoutError if the status never becomes recognizable.
          warn(
            `Unrecognized Soroban RPC transaction status "${String(res.status)}" for ${hash}; treating as pending`,
          );
          return "pending";
      }
    },
  };
}
