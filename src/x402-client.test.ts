import { describe, expect, it, vi } from "vitest";
import {
  createX402Client,
  decodePaymentRequired,
  expirationOffsetFor,
  selectRequirements,
  type FetchLike,
} from "./x402-client";
import {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  PaymentRejectedError,
  type PaymentRequirements,
  type SmartAccountX402Signer,
} from "./x402-types";
import { X402PaymentError } from "./errors";

const C_ADDRESS = "CC5ZSTLTYKPNIFDSJ4233RVZPALGHHDBRTXGIN6Z3AJCWU57VR5ITXXR";
const TOKEN = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const PAYTO = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";
const SIM_SOURCE = "GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA";

function b64(o: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function requirements(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: TOKEN,
    amount: "1000000",
    payTo: PAYTO,
    maxTimeoutSeconds: 120,
    extra: { areFeesSponsored: true },
    ...over,
  };
}

/** A 402 Response carrying the PAYMENT-REQUIRED header (x402 v2). */
function response402(accepts: PaymentRequirements[]): Response {
  return new Response("{}", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, error: "Payment required", accepts }) },
  });
}

/** A signer stub that never actually signs (guards should reject before signing). */
const stubSigner: SmartAccountX402Signer = {
  address: C_ADDRESS,
  async signAuthEntry() {
    throw new Error("signer should not have been called");
  },
};

function client(fetchImpl: FetchLike, signer: SmartAccountX402Signer = stubSigner) {
  return createX402Client({
    signer,
    rpcUrl: "https://soroban-testnet.stellar.org",
    network: "testnet",
    simulationSourceAccount: SIM_SOURCE,
    fetchImpl,
  });
}

describe("decodePaymentRequired", () => {
  it("decodes the PAYMENT-REQUIRED header", () => {
    const decoded = decodePaymentRequired(response402([requirements()]));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0]!.asset).toBe(TOKEN);
  });

  it("throws on a 402 with no PAYMENT-REQUIRED header", () => {
    const res = new Response("{}", { status: 402 });
    expect(() => decodePaymentRequired(res)).toThrow(NoUsablePaymentOptionError);
  });

  it("throws on a malformed PAYMENT-REQUIRED header", () => {
    const res = new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": "!!!not-base64!!!" } });
    expect(() => decodePaymentRequired(res)).toThrow(/Malformed PAYMENT-REQUIRED/);
  });
});

describe("x402 fetch — passthrough", () => {
  it("returns the response unchanged when no payment is required (2xx)", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const c = client(fetchImpl);
    const out = await c.fetch("https://res.test/paid", { maxAmount: 10n });
    expect(out.paid).toBe(false);
    expect(out.response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("x402 fetch — guards reject before signing", () => {
  it("MaxAmountExceededError when the price exceeds maxAmount", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements({ amount: "5000000" })]));
    const c = client(fetchImpl);
    await expect(c.fetch("https://res.test/paid", { maxAmount: 1000000n })).rejects.toBeInstanceOf(
      MaxAmountExceededError,
    );
    // Only the initial request happened; no payment retry.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("DisallowedAssetError when the asset is not in allowedAssets", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements()]));
    const c = client(fetchImpl);
    await expect(
      c.fetch("https://res.test/paid", { maxAmount: 10_000_000n, allowedAssets: ["COTHER"] }),
    ).rejects.toBeInstanceOf(DisallowedAssetError);
  });

  it("NoUsablePaymentOptionError when no exact/stellar:testnet option is offered", async () => {
    const fetchImpl = vi.fn(async () =>
      response402([requirements({ network: "eip155:1", scheme: "exact" })]),
    );
    const c = client(fetchImpl);
    await expect(c.fetch("https://res.test/paid", { maxAmount: 10_000_000n })).rejects.toBeInstanceOf(
      NoUsablePaymentOptionError,
    );
  });

  it("NoUsablePaymentOptionError when fees are not sponsored", async () => {
    const fetchImpl = vi.fn(async () =>
      response402([requirements({ extra: { areFeesSponsored: false } })]),
    );
    const c = client(fetchImpl);
    await expect(c.fetch("https://res.test/paid", { maxAmount: 10_000_000n })).rejects.toThrow(
      /do not sponsor fees/,
    );
  });
});

describe("createPayment — direct-path guards", () => {
  it("rejects over-maxAmount without touching the network", async () => {
    const c = client(vi.fn());
    await expect(
      c.createPayment(requirements({ amount: "9999999999" }), { maxAmount: 1n }),
    ).rejects.toBeInstanceOf(MaxAmountExceededError);
  });

  it("rejects a disallowed asset without touching the network", async () => {
    const c = client(vi.fn());
    await expect(
      c.createPayment(requirements(), { maxAmount: 10_000_000n, allowedAssets: ["COTHER"] }),
    ).rejects.toBeInstanceOf(DisallowedAssetError);
  });
});

// ── regression tests for the audit fixes ─────────────────────────────────────

describe("selectRequirements — pure selection logic (bug #7)", () => {
  const ALLOWED = "CALLOWEDASSET34567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567X";
  const CAIP2 = "stellar:testnet";
  const decoded = (accepts: PaymentRequirements[]) => ({ x402Version: 2, accepts });

  it("picks a later ALLOWED asset even when a disallowed one is offered first", () => {
    // The old pick-first logic would select TOKEN and wrongly reject.
    const picked = selectRequirements(
      decoded([
        requirements({ asset: TOKEN, amount: "1000000" }),
        requirements({ asset: ALLOWED, amount: "2000000" }),
      ]),
      { maxAmount: 10_000_000n, allowedAssets: [ALLOWED] },
      CAIP2,
    );
    expect(picked.asset).toBe(ALLOWED);
  });

  it("throws DisallowedAssetError only when NO offered asset is allowed", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ asset: TOKEN }), requirements({ asset: "COTHER" })]),
        { maxAmount: 10_000_000n, allowedAssets: ["CNONE"] },
        CAIP2,
      ),
    ).toThrow(DisallowedAssetError);
  });

  it("picks the cheapest allowed option when several are offered (no overpaying)", () => {
    const picked = selectRequirements(
      decoded([
        requirements({ asset: TOKEN, amount: "5000000" }),
        requirements({ asset: TOKEN, amount: "1000000" }),
      ]),
      { maxAmount: 10_000_000n },
      CAIP2,
    );
    expect(picked.amount).toBe("1000000");
  });

  it("skips an unsponsored option and picks a sponsored one", () => {
    const picked = selectRequirements(
      decoded([
        requirements({ asset: TOKEN, extra: { areFeesSponsored: false } }),
        requirements({ asset: ALLOWED, extra: { areFeesSponsored: true } }),
      ]),
      { maxAmount: 10_000_000n },
      CAIP2,
    );
    expect(picked.asset).toBe(ALLOWED);
  });

  it("enforces maxAmount on the chosen option", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ amount: "9999999" })]),
        { maxAmount: 1n },
        CAIP2,
      ),
    ).toThrow(MaxAmountExceededError);
  });

  it("throws when no option is on our network", () => {
    expect(() =>
      selectRequirements(
        decoded([requirements({ network: "eip155:1" })]),
        { maxAmount: 10_000_000n },
        CAIP2,
      ),
    ).toThrow(NoUsablePaymentOptionError);
  });
});

describe("expirationOffsetFor — derived from maxTimeoutSeconds (bug #5)", () => {
  it("derives a SHORT expiration for a short server timeout (no fixed +12)", () => {
    // 30s window ≈ 6 ledgers; minus the safety margin (2) = 4. A fixed +12 would
    // exceed the facilitator's ~6-ledger maxLedger and be rejected.
    expect(expirationOffsetFor(30)).toBe(4);
  });

  it("derives a wider expiration for a long timeout", () => {
    // 120s ≈ 24 ledgers − 2 = 22.
    expect(expirationOffsetFor(120)).toBe(22);
  });

  it("floors at the minimum for a tiny timeout", () => {
    expect(expirationOffsetFor(1)).toBe(3); // MIN_EXPIRATION_LEDGERS
  });

  it("respects an explicit ceiling", () => {
    expect(expirationOffsetFor(120, 10)).toBe(10);
  });

  it("defaults to the 120s window when maxTimeoutSeconds is undefined", () => {
    expect(expirationOffsetFor(undefined)).toBe(22);
  });
});

describe("amount validation (bug #6)", () => {
  it("throws InvalidRequirementsError on a non-integer amount", async () => {
    const c = client(vi.fn());
    await expect(
      c.createPayment(requirements({ amount: "1.5" }), { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(InvalidRequirementsError);
  });

  it("throws InvalidRequirementsError on a garbage amount", async () => {
    const c = client(vi.fn());
    await expect(
      c.createPayment(requirements({ amount: "abc" }), { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(InvalidRequirementsError);
  });

  it("throws InvalidRequirementsError on a negative amount", async () => {
    const c = client(vi.fn());
    await expect(
      c.createPayment(requirements({ amount: "-5" }), { maxAmount: 10_000_000n }),
    ).rejects.toBeInstanceOf(InvalidRequirementsError);
  });
});

describe("body replay (bug #3)", () => {
  it("rejects a ReadableStream body (can't be replayed on the paid retry)", async () => {
    const fetchImpl = vi.fn(async () => response402([requirements()]));
    const c = client(fetchImpl);
    const stream = new ReadableStream();
    await expect(
      c.fetch("https://res.test/paid", {
        method: "POST",
        body: stream,
        maxAmount: 10_000_000n,
      }),
    ).rejects.toBeInstanceOf(X402PaymentError);
    await expect(
      c.fetch("https://res.test/paid", {
        method: "POST",
        body: stream,
        maxAmount: 10_000_000n,
      }),
    ).rejects.toThrow(/ReadableStream body cannot be replayed/);
    // Rejected before ANY request went out.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
