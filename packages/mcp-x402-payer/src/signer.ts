// The payment signer — the ONLY part of this package that knows how a payment is
// built and signed.
//
// Today there is one implementation, backed by the official @x402 client with a
// plain ed25519 keypair. That is deliberate: the official client cannot sign for
// a Soroban smart account, because `AssembledTransaction.signAuthEntries` narrows
// the signer result to a naked buffer, which sends `authorizeEntry` down its
// ed25519 branch and calls `Keypair.fromPublicKey` on the entry's C-address —
// "invalid version byte. expected 48, got 16". The SDK's `{ signatureScVal }`
// escape hatch exists for exactly this case, but `signAuthEntries` closes it off.
//
// So the keypair version ships first, behind this interface. When upstream
// threads `authorizeEntry` through the client scheme, a smart-account
// implementation drops in here and nothing else in this package changes. We do
// NOT fork the SDK to get there.

import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import type { PayerConfig } from "./config.js";
import { SelectionMismatchError } from "./errors.js";
import type { X402Challenge, X402Requirement } from "./protocol.js";

/**
 * Signs one x402 payment.
 *
 * Contract for every implementation:
 *  - `challenge.accepts` arrives narrowed to exactly ONE already-cleared option.
 *  - A FRESH signature is produced on every call. Signatures expire in ledgers
 *    (~5s each), so a cached payload is a payload that will be rejected.
 *  - The returned value is the HTTP headers carrying the signature.
 */
export interface PaymentSigner {
  /** The paying address. `G…` today; `C…` once smart accounts are unblocked. */
  readonly address: string;
  signPayment(challenge: X402Challenge): Promise<Record<string, string>>;
}

/**
 * Build the official-client signer. Constructed ONCE at startup: the keypair is
 * derived a single time (fewer copies of key material over the process
 * lifetime), and a malformed secret fails here rather than at first payment.
 */
export function createOfficialSigner(config: PayerConfig): PaymentSigner {
  const signer = createEd25519Signer(config.secret, config.caip2);

  const client = new x402Client(
    // The default selector is `accepts[0]`. We always hand over a single
    // already-cleared option, so this only ever has one thing to pick — but
    // being explicit costs nothing and documents the intent.
    (_version, accepts) => accepts[0]!,
  ).register(
    config.caip2,
    new ExactStellarScheme(signer, config.rpcUrl ? { url: config.rpcUrl } : undefined),
  );

  // The tripwire (issue 2A). `createPaymentPayload` re-selects internally, so a
  // guard applied to the decoded challenge alone could clear option X while the
  // client pays option Y. We narrow `accepts` to one option before calling in,
  // and this hook fails the payment if what it is about to sign is not that
  // exact object. Unreachable today by construction — it exists so an upstream
  // change can never silently widen what gets paid.
  let expected: X402Requirement | undefined;
  client.onBeforePaymentCreation(async (ctx) => {
    if (expected === undefined) {
      throw new SelectionMismatchError(
        "Payment creation began with no cleared requirement recorded; refusing to sign.",
      );
    }
    // Identity, not equality: the object about to be signed must be the very one
    // the guards cleared, not merely one that looks like it.
    if ((ctx.selectedRequirements as unknown) !== (expected as unknown)) {
      throw new SelectionMismatchError(
        "The x402 client selected a payment option other than the one the guards cleared; " +
          "refusing to sign.",
      );
    }
  });

  const http = new x402HTTPClient(client);

  return {
    address: signer.address,

    async signPayment(challenge) {
      const accepts = challenge.accepts;
      if (accepts.length !== 1) {
        throw new SelectionMismatchError(
          `signPayment expects exactly one cleared payment option, got ${accepts.length}.`,
        );
      }
      expected = accepts[0]!;
      try {
        // Fresh every call — never cache a signed payload.
        const payload = await http.createPaymentPayload(
          challenge as unknown as Parameters<typeof http.createPaymentPayload>[0],
        );
        return http.encodePaymentSignatureHeader(payload);
      } finally {
        expected = undefined;
      }
    },
  };
}
