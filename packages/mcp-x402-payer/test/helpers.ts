// Shared test scaffolding. Everything here is hermetic: no network, no chain.

import { Keypair } from "@stellar/stellar-sdk";
import { loadConfig, type PayerConfig } from "../src/config.js";
import { createSpendLedger, type SpendLedger } from "../src/ledger.js";
import type { X402Challenge, X402Requirement } from "../src/protocol.js";
import type { PaymentSigner } from "../src/signer.js";

/** A valid Soroban contract id (the all-zeros placeholder). */
export const ASSET_A = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
export const ASSET_B = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
export const PAYTO = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";

/**
 * A freshly generated secret per call. No key material is ever committed to the
 * repo, and the leak tests get a distinctive value to search output for.
 */
export function freshSecret(): string {
  return Keypair.random().secret();
}

export function b64(o: unknown): string {
  return Buffer.from(JSON.stringify(o), "utf8").toString("base64");
}

export interface TestEnvOverrides {
  secret?: string;
  assets?: string;
  network?: string;
  maxResponseBytes?: string;
}

export function testEnv(over: TestEnvOverrides = {}): NodeJS.ProcessEnv {
  return {
    VELLAR_X402_SECRET: over.secret ?? freshSecret(),
    VELLAR_X402_ASSETS: over.assets ?? `${ASSET_A}:1000000,${ASSET_B}:500`,
    VELLAR_X402_NETWORK: over.network ?? "testnet",
    ...(over.maxResponseBytes ? { VELLAR_X402_MAX_RESPONSE_BYTES: over.maxResponseBytes } : {}),
  };
}

export function testConfig(over: TestEnvOverrides = {}): PayerConfig {
  return loadConfig(testEnv(over));
}

export function testLedger(config: PayerConfig): SpendLedger {
  return createSpendLedger(config.ceilings);
}

export function requirement(over: Partial<X402Requirement> = {}): X402Requirement {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: ASSET_A,
    amount: "1000",
    payTo: PAYTO,
    maxTimeoutSeconds: 120,
    extra: { areFeesSponsored: true },
    ...over,
  };
}

export function challenge(accepts: X402Requirement[] = [requirement()]): X402Challenge {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: { url: "https://res.test/paid", description: "A paid resource" },
    accepts,
  };
}

/** A 402 Response carrying a PAYMENT-REQUIRED header. */
export function response402(c: X402Challenge = challenge()): Response {
  return new Response("{}", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": b64(c) },
  });
}

/**
 * A deterministic, well-formed 64-hex transaction hash derived from a label.
 * The payer validates the shape (security audit V-2), so fixtures must use
 * realistic hashes rather than "tx-1".
 */
export function txHash(label: string): string {
  let h = "";
  for (let i = 0; h.length < 64; i++) {
    h += [...`${label}#${i}`]
      .reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381)
      .toString(16)
      .padStart(8, "0");
  }
  return h.slice(0, 64);
}

/** A 200 Response carrying a settlement header (a successful paid retry). */
export function responsePaid(transaction: string, body = '{"ok":true}'): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "X-PAYMENT-RESPONSE": b64({
        success: true,
        transaction: /^[0-9a-f]{64}$/i.test(transaction) ? transaction : txHash(transaction),
        payer: PAYTO,
      }),
    },
  });
}

/**
 * A 200 whose settlement carries an EMPTY transaction. Nothing was spent.
 */
export function responseUnsettled(body = '{"ok":true}'): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "X-PAYMENT-RESPONSE": b64({ success: false, transaction: "", payer: PAYTO }),
    },
  });
}

/**
 * The REAL benign settle failure, captured live from a local facilitator under
 * RPC contention: HTTP 402 with success=false and an EMPTY transaction. Nothing
 * reached the chain, so nothing was spent and a fresh retry is safe.
 */
export function responseSettleFailed(
  errorReason = "settle_exact_stellar_transaction_submission_failed",
): Response {
  return new Response(
    JSON.stringify({ error: "x402_failed", stage: "settle", detail: errorReason }),
    {
      status: 402,
      headers: {
        "content-type": "application/json",
        "PAYMENT-RESPONSE": b64({
          success: false,
          errorReason,
          payer: PAYTO,
          transaction: "",
          network: "stellar:testnet",
        }),
      },
    },
  );
}

/**
 * The TERMINAL settle failure, also captured live: the transaction WAS
 * submitted (non-empty hash) and fees were charged, but it failed on-chain.
 * Retrying this burns fees again.
 */
export function responseSubmittedButFailed(transaction = "c55bfccd24083f67"): Response {
  return new Response(
    JSON.stringify({ error: "x402_failed", stage: "settle", detail: "settle_exact_stellar_transaction_failed" }),
    {
      status: 402,
      headers: {
        "content-type": "application/json",
        "PAYMENT-RESPONSE": b64({
          success: false,
          errorReason: "settle_exact_stellar_transaction_failed",
          payer: PAYTO,
          transaction,
          network: "stellar:testnet",
        }),
      },
    },
  );
}

/** A verify-stage rejection: a 402 with NO settle header at all. Deterministic. */
export function responseVerifyRejected(reason = "over budget"): Response {
  return new Response(JSON.stringify({ error: "x402_failed", stage: "verify", detail: reason }), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": b64({ x402Version: 2, error: reason, accepts: [] }),
    },
  });
}

export interface StubSigner extends PaymentSigner {
  /** Challenges handed to signPayment, in order — one entry per signature. */
  readonly calls: X402Challenge[];
}

/**
 * A signer that records what it was asked to sign without touching the chain.
 *
 * `calls.length` is how many FRESH signatures were produced, which is what the
 * retry tests assert on: a cached payload would show up as one call for several
 * attempts.
 */
export function stubSigner(
  address = PAYTO,
  onSign?: (c: X402Challenge, callIndex: number) => void,
): StubSigner {
  const calls: X402Challenge[] = [];
  return {
    address,
    calls,
    async signPayment(c) {
      onSign?.(c, calls.length);
      calls.push(c);
      return { "PAYMENT-SIGNATURE": `signed-${calls.length}` };
    },
  };
}

/** A signer that throws if it is ever called — proves a refusal beat signing. */
export function neverCalledSigner(address = PAYTO): PaymentSigner {
  return {
    address,
    async signPayment() {
      throw new Error("signer should not have been called");
    },
  };
}

/**
 * A fetch stub that replays a scripted sequence of responses.
 *
 * `requests` is the live array of calls made — assert on `requests.length`
 * rather than a snapshotted counter.
 */
export function scriptedFetch(responses: Response[]) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    const res = responses[requests.length - 1];
    if (!res) throw new Error(`scriptedFetch ran out of responses at call ${requests.length}`);
    return res;
  };
  return Object.assign(impl, { requests });
}
