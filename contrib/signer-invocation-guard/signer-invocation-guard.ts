import { xdr } from "@stellar/stellar-sdk";
import { assertAuthEntryInvocation, type ExpectedInvocation } from "../../src/x402-auth-entry";
import type { SmartAccountX402Signer } from "../../src/x402-types";

export interface SignAuthEntryOptionsWithGuard {
  networkPassphrase: string;
  expirationLedger: number;
  expectedInvocation?: ExpectedInvocation;
}

/**
 * Wraps a SmartAccountX402Signer to validate expectedInvocation internally
 * prior to calling the underlying signAuthEntry method (#382).
 */
export function withSignerInvocationGuard(signer: SmartAccountX402Signer): SmartAccountX402Signer {
  return {
    address: signer.address,
    async signAuthEntry(entryXdr: string, opts: SignAuthEntryOptionsWithGuard): Promise<string> {
      if (opts.expectedInvocation) {
        const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");
        assertAuthEntryInvocation(entry, opts.expectedInvocation);
      }
      return signer.signAuthEntry(entryXdr, opts);
    },
  };
}
