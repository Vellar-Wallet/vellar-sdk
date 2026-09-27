// Capability guard for x402 signers (#408).
//
// src/x402-signer-capabilities.ts already defines the check and its header
// says the signer runs it BEFORE hashing. On the live signAuthEntry path the
// check is dead code (after a try/catch that always returns). This wrapper
// makes the check unbypassable for any caller — including one that invokes
// signAuthEntry directly, skipping x402-client.ts.
//
// Empty rules permit everything, matching today's default so wrapping an
// existing signer with no rules is a no-op.

import { Address, xdr } from "@stellar/stellar-sdk";
import {
  assertCapability,
  assertValidCapabilityRules,
  type CapabilityRule,
} from "../../src/x402-signer-capabilities";
import type { SmartAccountX402Signer } from "../../src/x402-types";

function capabilityRequestFor(
  entry: xdr.SorobanAuthorizationEntry,
): { resourceType: string; action: string } | undefined {
  const fn = entry.rootInvocation().function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") return undefined;
  const call = fn.contractFn();
  return {
    resourceType: Address.fromScAddress(call.contractAddress()).toString(),
    action: call.functionName().toString(),
  };
}

/**
 * Wrap a signer so capability rules run as the first thing signAuthEntry
 * does, before the inner signer hashes. Complements #382's invocation-shape
 * guard — this is the allowlist, not the expected-payment assertion.
 */
export function withCapabilityGuard(
  signer: SmartAccountX402Signer,
  capabilities: readonly CapabilityRule[] = [],
): SmartAccountX402Signer {
  assertValidCapabilityRules(capabilities);
  return {
    address: signer.address,
    async signAuthEntry(entryXdr, opts) {
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, "base64");
      const request = capabilityRequestFor(entry);
      if (request) assertCapability(capabilities, request);
      return signer.signAuthEntry(entryXdr, opts);
    },
  };
}
