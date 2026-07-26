// x402 facade — the thin glue that exposes `wallet.x402` on the handle.
//
// Mirrors policy-facade.ts: a small factory over structural deps, so the handle
// wires it up once and callers get a ready client (or a clear error when x402
// isn't configured). The heavy lifting is in x402-client.ts + x402-signer.ts.

import { createX402Client, type FetchLike } from "./x402-client";
import {
  X402NotConfiguredError,
  type SmartAccountX402Signer,
  type X402Client,
} from "./x402-types";
import type { Network } from "./types";

export interface X402FacadeDeps {
  /** Present ⇒ x402 is configured. Absent ⇒ the facade throws a clear error. */
  config?: {
    rpcUrl: string;
    network: Network;
    /** Funded classic G-account used only as the simulation tx source. */
    simulationSourceAccount: string;
    fetchImpl?: FetchLike;
    expirationLedgerOffset?: number;
  };
  /** Resolves the x402 signer for the connected wallet (throws if not ready). */
  resolveSigner: () => SmartAccountX402Signer;
}

/**
 * Build the `wallet.x402` client. When x402 config is absent, every call throws
 * `X402NotConfiguredError` (same ergonomics as `wallet.policies` without apiUrl).
 */
export function createX402Facade(deps: X402FacadeDeps): X402Client {
  function client(): X402Client {
    if (!deps.config) {
      throw new X402NotConfiguredError(
        "wallet.x402 requires `x402` config in createVellarWallet (rpcUrl, network, simulationSourceAccount).",
      );
    }
    return createX402Client({
      signer: deps.resolveSigner(),
      rpcUrl: deps.config.rpcUrl,
      network: deps.config.network,
      simulationSourceAccount: deps.config.simulationSourceAccount,
      fetchImpl: deps.config.fetchImpl,
      expirationLedgerOffset: deps.config.expirationLedgerOffset,
    });
  }

  // async wrappers so a synchronous `client()` throw (missing config) surfaces as
  // a rejected promise, not a thrown exception at the call site.
  return {
    fetch: async (url, init) => client().fetch(url, init),
    createPayment: async (requirements, opts) => client().createPayment(requirements, opts),
  };
}
