// Example: an x402 (HTTP 402) "pay to unlock" flow with a lower-cost fallback.
//
// It wires up a MOCK x402 client and a MOCK resource server (both defined in
// this file, no network) that mirror vellar-sdk's real surface:
//   - the client implements the SDK's `X402Client` interface (src/x402-types.ts)
//   - it throws the SDK's real `PaymentRejectedError` when the facilitator
//     rejects a payment for exceeding the wallet's on-chain spending budget.
//
// The resource server offers two accepted tiers (a premium and a basic price).
// The client pays the most premium tier it can afford under `maxAmount`. When
// the facilitator rejects that payment as over-budget, `fetchWithPaymentFallback`
// catches `PaymentRejectedError` and retries ONCE at a lower `maxAmount`, which
// selects the cheaper tier and settles within budget.
//
// Run with: npx tsx x402-fetch-fallback.ts

import {
  DisallowedAssetError,
  MaxAmountExceededError,
  PaymentRejectedError,
  type PaymentRequired,
  type PaymentRequirements,
  type SignedPayment,
  type X402Client,
  type X402FetchInit,
  type X402Response,
  type X402Settlement,
} from "../../../src/x402-types";
import type { Network } from "../../../src/types";

// ── sample identifiers (mock; not validated on-chain) ───────────────────────
const NETWORK_CAIP2 = "stellar:testnet";
const USDC_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"; // SEP-41 token (SAC)
const PAY_TO = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND"; // resource server payee
const PAYER = "CC5ZSTLTYKPNIFDSJ4233RVZPALGHHDBRTXGIN6Z3AJCWU57VR5ITXXR"; // our smart-account wallet

const PREMIUM_AMOUNT = "800"; // base units
const BASIC_AMOUNT = "400";

// ── mock resource server ────────────────────────────────────────────────────

export interface MockResourceServer {
  /** Answer an unpaid request with a 402 challenge (two accepted tiers). */
  quote(url: string): PaymentRequired;
  /** Serve the unlocked content once a payment has been settled. */
  deliver(url: string): Response;
  /** How many times `quote()` was called — proves the retry count in tests. */
  quotes(): number;
}

function requirement(amount: string, description: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK_CAIP2,
    asset: USDC_SAC,
    amount,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { description },
  };
}

/** A mock x402 resource server offering a premium and a basic tier. */
export function createMockResourceServer(): MockResourceServer {
  let quoteCount = 0;
  return {
    quote(url) {
      quoteCount += 1;
      return {
        x402Version: 2,
        error: "payment required",
        accepts: [
          requirement(PREMIUM_AMOUNT, "premium quarterly report"),
          requirement(BASIC_AMOUNT, "basic quarterly summary"),
        ],
        resource: { url, description: "Quarterly report", mimeType: "application/json" },
      };
    },
    deliver(url) {
      return new Response(
        JSON.stringify({ url, report: "Q3 revenue up 12% YoY", unlocked: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    quotes: () => quoteCount,
  };
}

// ── mock facilitator (enforces the wallet's remaining on-chain budget) ───────

export interface MockFacilitator {
  /** Verify + settle a payment. Throws PaymentRejectedError when over budget. */
  settle(payment: SignedPayment): X402Settlement;
  /** How many settle attempts were made — proves "retry at most once". */
  attempts(): number;
  /** Remaining spending-limit budget, in base units. */
  remaining(): bigint;
}

export function createMockFacilitator(config: {
  remainingBudget: bigint;
  network?: Network;
}): MockFacilitator {
  let remaining = config.remainingBudget;
  let attempts = 0;
  let txSeq = 0;
  const network = config.network ?? "testnet";

  return {
    settle(payment) {
      attempts += 1;
      if (payment.amount > remaining) {
        // Mirrors the real flow: the on-chain spending-limit policy blocks the
        // over-budget transfer, so the facilitator reports a rejection.
        throw new PaymentRejectedError(
          `facilitator rejected payment of ${payment.amount}: exceeds remaining budget ${remaining}`,
          "over_budget",
        );
      }
      remaining -= payment.amount;
      txSeq += 1;
      // The facilitator reads the payer out of the (mock) payment header.
      const payer = payment.header.split(":")[3] ?? PAYER;
      return {
        transaction: `mocktx-${String(txSeq).padStart(4, "0")}`,
        payer,
        asset: payment.requirements.asset,
        amount: payment.amount,
        network,
      };
    },
    attempts: () => attempts,
    remaining: () => remaining,
  };
}

// ── mock x402 client (implements the SDK's X402Client) ──────────────────────

/** Pick the most premium tier the caller can afford under `maxAmount`
 * (respecting `allowedAssets`), mirroring how a client maximizes service
 * quality within budget. Throws the SDK's real errors when nothing fits. */
function chooseRequirements(
  accepts: PaymentRequirements[],
  init: Pick<X402FetchInit, "maxAmount" | "allowedAssets">,
): PaymentRequirements {
  const byAsset = init.allowedAssets
    ? accepts.filter((a) => init.allowedAssets!.includes(a.asset))
    : accepts;
  if (byAsset.length === 0) {
    throw new DisallowedAssetError(accepts[0]?.asset ?? "?", init.allowedAssets ?? []);
  }
  const affordable = byAsset.filter((a) => BigInt(a.amount) <= init.maxAmount);
  if (affordable.length === 0) {
    const cheapest = byAsset.reduce((m, a) => (BigInt(a.amount) < BigInt(m.amount) ? a : m));
    throw new MaxAmountExceededError(BigInt(cheapest.amount), init.maxAmount, cheapest.asset);
  }
  return affordable.reduce((m, a) => (BigInt(a.amount) > BigInt(m.amount) ? a : m));
}

export function createMockX402Client(config: {
  server: MockResourceServer;
  facilitator: MockFacilitator;
  payer: string;
}): X402Client {
  async function createPayment(
    requirements: PaymentRequirements,
    opts: { maxAmount: bigint; allowedAssets?: string[] },
  ): Promise<SignedPayment> {
    if (opts.allowedAssets && !opts.allowedAssets.includes(requirements.asset)) {
      throw new DisallowedAssetError(requirements.asset, opts.allowedAssets);
    }
    const amount = BigInt(requirements.amount);
    if (amount > opts.maxAmount) {
      throw new MaxAmountExceededError(amount, opts.maxAmount, requirements.asset);
    }
    return {
      header: `mockpay:${requirements.asset}:${amount}:${config.payer}`,
      requirements,
      amount,
    };
  }

  async function fetch(url: string, init: X402FetchInit): Promise<X402Response> {
    const challenge = config.server.quote(url); // 402 + accepted tiers
    const chosen = chooseRequirements(challenge.accepts, init); // most premium affordable
    const payment = await createPayment(chosen, init); // "sign" the payment
    const settlement = config.facilitator.settle(payment); // may throw PaymentRejectedError
    return { response: config.server.deliver(url), paid: true, settlement };
  }

  return { fetch, createPayment };
}

// ── the fallback wrapper ────────────────────────────────────────────────────

export interface FallbackFetchInit extends X402FetchInit {
  /** `maxAmount` to retry with — once — if the first attempt is rejected. */
  fallbackMaxAmount: bigint;
}

export interface FallbackOptions {
  /** Injectable logger (tests pass a no-op). Defaults to console.log. */
  log?: (message: string) => void;
}

/**
 * Call `client.fetch(url, init)`. If it fails with `PaymentRejectedError`
 * (the facilitator rejected the payment as over-budget), retry EXACTLY ONCE
 * with `fallbackMaxAmount` — a lower ceiling that selects the cheaper tier.
 * Any other error, and a second rejection, propagate to the caller.
 */
export async function fetchWithPaymentFallback(
  client: X402Client,
  url: string,
  init: FallbackFetchInit,
  options: FallbackOptions = {},
): Promise<X402Response> {
  const log = options.log ?? ((m: string) => console.log(m));
  const { fallbackMaxAmount, ...first } = init;
  try {
    return await client.fetch(url, first);
  } catch (err) {
    if (!(err instanceof PaymentRejectedError)) throw err;
    log(`  ! payment rejected (${err.reason ?? "unknown"}): ${err.message}`);
    log(`  > retrying once at lower maxAmount ${fallbackMaxAmount}`);
    return client.fetch(url, { ...first, maxAmount: fallbackMaxAmount });
  }
}

async function main(): Promise<void> {
  const server = createMockResourceServer();
  const facilitator = createMockFacilitator({ remainingBudget: 500n });
  const client = createMockX402Client({ server, facilitator, payer: PAYER });

  console.log(`Remaining on-chain budget: ${facilitator.remaining()} base units`);
  console.log(`Premium tier: ${PREMIUM_AMOUNT}, basic tier: ${BASIC_AMOUNT}`);
  console.log("");
  console.log("1. GET /reports/quarterly with maxAmount=1000 (fallback=450)...");

  const res = await fetchWithPaymentFallback(client, "/reports/quarterly", {
    maxAmount: 1000n,
    fallbackMaxAmount: 450n,
  });

  const body = (await res.response.json()) as Record<string, unknown>;
  console.log(`2. Unlocked (paid=${res.paid}, status=${res.response.status}): ${JSON.stringify(body)}`);
  if (res.settlement) {
    console.log(
      `3. Settled ${res.settlement.amount} of ${res.settlement.asset} on ${res.settlement.network}` +
        ` — tx ${res.settlement.transaction}`,
    );
  }
  console.log(`4. Server quoted ${server.quotes()}x; facilitator settle attempts: ${facilitator.attempts()}`);
  console.log(`   Remaining budget now: ${facilitator.remaining()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
