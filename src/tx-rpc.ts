import { rpc, StrKey } from "@stellar/stellar-sdk";
import type { TxStatus, TxStatusReader } from "./tx-status";

// RPC-backed pieces of the payment flow (subpath export — see rpc.ts).

/** Accepts classic (G...) and contract (C...) addresses. */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);
}

export function createRpcTxStatusReader(options: { rpcUrl: string }): TxStatusReader {
  const server = new rpc.Server(options.rpcUrl);
  return {
    async getStatus(hash): Promise<TxStatus> {
      const res = await server.getTransaction(hash);
      switch (res.status) {
        case rpc.Api.GetTransactionStatus.SUCCESS:
          return "success";
        case rpc.Api.GetTransactionStatus.FAILED:
          return "failed";
        default:
          // NOT_FOUND: not yet included in a ledger.
          return "pending";
      }
    },
  };
}
