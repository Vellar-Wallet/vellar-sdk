import { describe, expect, it, vi } from "vitest";
import type { PayerConfig } from "./config.js";
import { createSpendLedger } from "./ledger.js";
import type { PayResult, Payer } from "./payer.js";
import { NoPayableResultError, payAndCall, selectCandidates } from "./pay-and-call.js";

const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const OTHER_ASSET = "CDYCX4PEZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";
const CAIP2 = "stellar:testnet";

const config = {
  caip2: CAIP2,
  allowedAssets: [ASSET],
} as unknown as PayerConfig;

function entry(url: string, amount: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    resource: url,
    accepts: [
      {
        scheme: "exact",
        network: CAIP2,
        amount,
        asset: ASSET,
        extra: { areFeesSponsored: true },
        ...over,
      },
    ],
  };
}

function searchResponse(resources: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ resources }),
  } as unknown as Response;
}

function stubPayer(): Payer {
  return {
    payerAddress: "GTEST",
    quote: vi.fn(),
    pay: vi.fn(async (url: string) => ({
      url,
      paid: true,
      content: { contentType: "application/json", bytes: 2, text: "{}" },
      settlement: {
        transaction: "a".repeat(64),
        payer: "GTEST",
        asset: ASSET,
        amount: "1000000",
        network: CAIP2,
      },
    })) as unknown as Payer["pay"],
  } as unknown as Payer;
}

/** A ledger with room, unless `ceiling` says otherwise. */
function ledgerWith(ceiling = 10_000_000n) {
  return createSpendLedger(new Map([[ASSET, ceiling]]));
}

describe("x402_pay_and_call", () => {
  it("T-1: finds a payable result and returns it without error", async () => {
    const payer = stubPayer();
    const result = await payAndCall(
      {
        payer,
        config,
        ledger: ledgerWith(),
        facilitatorUrl: "https://facilitator.test",
        fetchImpl: vi.fn(async () =>
          searchResponse([entry("https://seller.test/quote", "1000000")]),
        ) as never,
      },
      "quote",
      "1000000",
    );

    expect(result.paid).toBe(true);
    expect(result.selectedUrl).toBe("https://seller.test/quote");
    expect(result.query).toBe("quote");
    expect(result.resultsFound).toBe(1);
    expect(result.resultsPayable).toBe(1);
    expect(result.settlement?.transaction).toHaveLength(64);
    expect(payer.pay).toHaveBeenCalledWith("https://seller.test/quote", "1000000");
  });

  it("T-2: refuses when everything is over max_amount, naming the cheapest price", async () => {
    const payer = stubPayer();
    const call = payAndCall(
      {
        payer,
        config,
        ledger: ledgerWith(),
        facilitatorUrl: "https://facilitator.test",
        fetchImpl: vi.fn(async () =>
          searchResponse([
            entry("https://seller.test/dear", "9000000"),
            entry("https://seller.test/less", "5000000"),
          ]),
        ) as never,
      },
      "quote",
      "1000000",
    );

    await expect(call).rejects.toThrow(NoPayableResultError);
    // The cheapest price must be in the message: it is what lets the agent ask
    // the user for a specific amount instead of guessing.
    await expect(call).rejects.toThrow(/5000000/);
    await expect(call).rejects.toThrow(/[Nn]othing was signed/);
    expect(payer.pay).not.toHaveBeenCalled();
  });

  it("T-3: refuses when no result matches the configured asset", async () => {
    const payer = stubPayer();
    const call = payAndCall(
      {
        payer,
        config,
        ledger: ledgerWith(),
        facilitatorUrl: "https://facilitator.test",
        fetchImpl: vi.fn(async () =>
          searchResponse([entry("https://seller.test/other", "1", { asset: OTHER_ASSET })]),
        ) as never,
      },
      "quote",
      "1000000",
    );

    await expect(call).rejects.toThrow(/no result is payable by this server/);
    expect(payer.pay).not.toHaveBeenCalled();
  });

  it("T-4: reports the cold-start hint when the Bazaar is unreachable", async () => {
    const payer = stubPayer();
    const call = payAndCall(
      {
        payer,
        config,
        ledger: ledgerWith(),
        facilitatorUrl: "https://facilitator.test",
        fetchImpl: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }) as never,
      },
      "quote",
      "1000000",
    );

    await expect(call).rejects.toThrow(/could not reach the Bazaar/);
    await expect(call).rejects.toThrow(/45 seconds/);
    expect(payer.pay).not.toHaveBeenCalled();
  });

  it("T-5: checks the session ceiling before searching or paying", async () => {
    const payer = stubPayer();
    const fetchImpl = vi.fn(async () => searchResponse([entry("https://seller.test/q", "1")]));
    // Ceiling fully consumed: nothing can be bought, so nothing should be
    // searched for either.
    const ledger = ledgerWith(1_000_000n);
    ledger.record(ASSET, 1_000_000n);

    await expect(
      payAndCall(
        { payer, config, ledger, facilitatorUrl: "https://facilitator.test", fetchImpl: fetchImpl as never },
        "quote",
        "1000000",
      ),
    ).rejects.toThrow(/session ceiling exhausted/);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(payer.pay).not.toHaveBeenCalled();
  });

  it("T-6: selects the cheapest result when several qualify", async () => {
    const payer = stubPayer();
    const result = await payAndCall(
      {
        payer,
        config,
        ledger: ledgerWith(),
        facilitatorUrl: "https://facilitator.test",
        fetchImpl: vi.fn(async () =>
          searchResponse([
            entry("https://seller.test/dear", "900000"),
            entry("https://seller.test/cheap", "100000"),
            entry("https://seller.test/mid", "500000"),
          ]),
        ) as never,
      },
      "quote",
      "1000000",
    );

    expect(result.selectedUrl).toBe("https://seller.test/cheap");
    expect(result.resultsPayable).toBe(3);
    expect(payer.pay).toHaveBeenCalledWith("https://seller.test/cheap", "1000000");
  });

  it("rejects a malformed max_amount before touching the network", async () => {
    const fetchImpl = vi.fn();
    await expect(
      payAndCall(
        { payer: stubPayer(), config, ledger: ledgerWith(), fetchImpl: fetchImpl as never },
        "quote",
        "1.5",
      ),
    ).rejects.toThrow(/base units/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("selectCandidates", () => {
  it("sorts payable results cheapest first", () => {
    const { payable, resultsFound } = selectCandidates(
      { resources: [entry("https://a.test", "300"), entry("https://b.test", "100")] },
      config,
    );
    expect(resultsFound).toBe(2);
    expect(payable.map((c) => c.amount)).toEqual([100n, 300n]);
  });

  it("drops entries whose fees are not sponsored", () => {
    // Without sponsorship the payer needs XLM of its own, so these are not
    // payable by a zero-XLM smart account even though the price fits.
    const { payable } = selectCandidates(
      { resources: [entry("https://a.test", "100", { extra: { areFeesSponsored: false } })] },
      config,
    );
    expect(payable).toHaveLength(0);
  });

  it("drops non-exact schemes", () => {
    const { payable } = selectCandidates(
      { resources: [entry("https://a.test", "100", { scheme: "upto" })] },
      config,
    );
    expect(payable).toHaveLength(0);
  });

  it("drops entries on a different network", () => {
    const { payable } = selectCandidates(
      { resources: [entry("https://a.test", "100", { network: "stellar:pubnet" })] },
      config,
    );
    expect(payable).toHaveLength(0);
  });

  it("drops a malformed amount rather than treating it as free", () => {
    const { payable } = selectCandidates(
      { resources: [entry("https://a.test", "not-a-number")] },
      config,
    );
    expect(payable).toHaveLength(0);
  });

  it("tolerates an empty or missing resources array", () => {
    expect(selectCandidates({}, config).payable).toHaveLength(0);
    expect(selectCandidates({ resources: [] }, config).resultsFound).toBe(0);
  });
});
