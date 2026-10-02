// The payment signer — the ONLY part of this package that knows how a payment is
// built and signed. Two implementations, chosen by configuration:
//
//   KEYPAIR (layer 1 only) — the official @x402 client with a plain ed25519 key.
//   The spending ceiling is enforced by this process; the key is a hot wallet.
//
//   SMART ACCOUNT (layer 2) — our own scheme client, paying from a Soroban smart
//   account whose spending-limit policy is enforced on-chain inside
//   `__check_auth`. The model cannot exceed it whatever it emits.
//
// The smart-account path needs its own scheme because the official one cannot
// sign for a `C…` credential address: `AssembledTransaction.signAuthEntries`
// narrows the signer result to a naked buffer, which sends `authorizeEntry` down
// its ed25519 branch and throws "invalid version byte. expected 48, got 16".
// Filed upstream as x402-foundation/x402#3159. We register our own
// `SchemeNetworkClient` — a documented extension point, not a fork — and are
// therefore not waiting on that fix.

import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createSessionKeySigner } from "vellar-sdk";
import type { PayerConfig } from "./config.js";
import { SelectionMismatchError } from "./errors.js";
import type { X402Challenge, X402Requirement } from "./protocol.js";
import { createSmartAccountScheme } from "./smart-account-scheme.js";

/** Soroban RPC defaults when `VELLAR_X402_RPC_URL` is unset. */
const DEFAULT_RPC_URL: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

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
  /** The paying address: `G…` for a keypair, `C…` for a smart account. */
  readonly address: string;
  signPayment(challenge: X402Challenge): Promise<Record<string, string>>;
}

/**
 * The selection tripwire, shared by both signers.
 *
 * `createPaymentPayload` re-selects internally, so a guard applied to the
 * decoded challenge alone could clear option X while the client pays option Y.
 * We narrow `accepts` to one option before calling in; this fails the payment if
 * what is about to be signed is not that exact object. Unreachable today by
 * construction — it exists so an upstream change cannot silently widen what gets
 * paid.
 */
function selectionTripwire() {
  const expected: { current?: X402Requirement } = {};
  return {
    expected,
    install(client: x402Client) {
      client.onBeforePaymentCreation(async (ctx) => {
        if (expected.current === undefined) {
          throw new SelectionMismatchError(
            "Payment creation began with no cleared requirement recorded; refusing to sign.",
          );
        }
        // Identity, not equality: the object about to be signed must be the very
        // one the guards cleared, not merely one that looks like it.
        if ((ctx.selectedRequirements as unknown) !== (expected.current as unknown)) {
          throw new SelectionMismatchError(
            "The x402 client selected a payment option other than the one the guards cleared; " +
              "refusing to sign.",
          );
        }
      });
    },
  };
}

/**
 * Build the SMART-ACCOUNT signer — the layer-2 path.
 *
 * Registers our own scheme client rather than `ExactStellarScheme`, because the
 * official one cannot sign for a `C…` credential address (upstream
 * x402-foundation/x402#3159). Everything above this seam — guards, narrowing,
 * the selection tripwire, retry, the session ledger — is unchanged, which is
 * what the `PaymentSigner` interface was for.
 *
 * The spending limit here is enforced by the wallet contract, not by this
 * process: over-budget payments are refused inside `__check_auth` and no amount
 * of emitted text changes that.
 */
export function createSmartAccountSigner(config: PayerConfig): PaymentSigner {
  if (!config.walletAddress) {
    throw new Error("createSmartAccountSigner requires VELLAR_X402_WALLET");
  }

  const accountSigner = createSessionKeySigner({
    address: config.walletAddress,
    secretKey: config.secret,
    policies: config.policies,
  });

  const client = new x402Client((_v, accepts) => accepts[0]!).register(
    config.caip2,
    createSmartAccountScheme({
      signer: accountSigner,
      rpcUrl: config.rpcUrl ?? DEFAULT_RPC_URL[config.network]!,
    }) as never,
  );

  const { expected, install } = selectionTripwire();
  install(client);
  const http = new x402HTTPClient(client);

  return {
    address: config.walletAddress,
    async signPayment(challenge) {
      const accepts = challenge.accepts;
      if (accepts.length !== 1) {
        throw new SelectionMismatchError(
          `signPayment expects exactly one cleared payment option, got ${accepts.length}.`,
        );
      }
      expected.current = accepts[0]!;
      try {
        const payload = await http.createPaymentPayload(
          challenge as unknown as Parameters<typeof http.createPaymentPayload>[0],
        );
        return http.encodePaymentSignatureHeader(payload);
      } finally {
        expected.current = undefined;
      }
    },
  };
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

  const { expected, install } = selectionTripwire();
  install(client);
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
      expected.current = accepts[0]!;
      try {
        // Fresh every call — never cache a signed payload.
        const payload = await http.createPaymentPayload(
          challenge as unknown as Parameters<typeof http.createPaymentPayload>[0],
        );
        return http.encodePaymentSignatureHeader(payload);
      } finally {
        expected.current = undefined;
      }
    },
  };
}
