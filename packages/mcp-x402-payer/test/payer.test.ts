// Payer boundary tests.
//
// Guard SEMANTICS are tested once, purely, in vellar-sdk's x402-guards.test.ts.
// What is tested here is the boundary contract that only exists at this layer:
// that a refusal happens BEFORE anything is signed, that the ledger is debited
// exactly once and only on a confirmed settlement, and that retries sign afresh.

import { describe, expect, it } from "vitest";
import {
  DisallowedAssetError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  PaymentRejectedError,
  SessionCeilingExceededError,
  SettlementFailedError,
} from "../src/errors.js";
import { createPayer } from "../src/payer.js";
import {
  ASSET_A,
  ASSET_B,
  b64,
  challenge,
  neverCalledSigner,
  requirement,
  response402,
  responsePaid,
  responseSettleFailed,
  responseSubmittedButFailed,
  responseUnsettled,
  responseVerifyRejected,
  scriptedFetch,
  stubSigner,
  txHash,
  testConfig,
  testLedger,
} from "./helpers.js";
import type { PaymentSigner } from "../src/signer.js";
import type { SpendLedger } from "../src/ledger.js";
import type { PayerConfig } from "../src/config.js";

const URL = "https://res.test/paid";

function makePayer(
  responses: Response[],
  signer: PaymentSigner = stubSigner(),
  config: PayerConfig = testConfig(),
  ledger: SpendLedger = testLedger(config),
) {
  const fetchImpl = scriptedFetch(responses);
  const payer = createPayer({ config, ledger, signer, fetchImpl });
  return { payer, fetchImpl, ledger, config };
}

describe("pay — no payment required", () => {
  it("returns the content and spends nothing when the first request is a 200", async () => {
    const signer = neverCalledSigner();
    const { payer, fetchImpl, ledger } = makePayer(
      [new Response("plain body", { status: 200, headers: { "content-type": "text/plain" } })],
      signer,
    );

    const result = await payer.pay(URL, "1000000");

    expect(result.paid).toBe(false);
    expect(result.settlement).toBeUndefined();
    expect(result.content.text).toBe("plain body");
    expect(fetchImpl.requests.length).toBe(1);
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n);
  });
});

describe("pay — guards refuse before signing", () => {
  // The assertion that matters at this layer: `neverCalledSigner` throws if
  // reached, so each of these proves the refusal beat the signing path.

  it("refuses a price above max_amount", async () => {
    const { payer, fetchImpl, ledger } = makePayer(
      [response402(challenge([requirement({ amount: "5000" })]))],
      neverCalledSigner(),
    );

    await expect(payer.pay(URL, "1000")).rejects.toBeInstanceOf(MaxAmountExceededError);
    expect(fetchImpl.requests.length).toBe(1); // no paid retry
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n);
  });

  it("refuses an asset that is not on the allowlist", async () => {
    const unlisted = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
    const { payer } = makePayer(
      [response402(challenge([requirement({ asset: unlisted })]))],
      neverCalledSigner(),
    );

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(DisallowedAssetError);
  });

  it("refuses a challenge on the wrong network", async () => {
    const { payer } = makePayer(
      [response402(challenge([requirement({ network: "eip155:1" })]))],
      neverCalledSigner(),
    );

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(NoUsablePaymentOptionError);
  });

  it("refuses a malformed PAYMENT-REQUIRED header", async () => {
    const bad = new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": "!!!not-base64!!!" },
    });
    const { payer } = makePayer([bad], neverCalledSigner());

    await expect(payer.pay(URL, "1000000")).rejects.toThrow(/Malformed PAYMENT-REQUIRED/);
  });

  it("refuses a 402 carrying no PAYMENT-REQUIRED header at all", async () => {
    const { payer } = makePayer([new Response("{}", { status: 402 })], neverCalledSigner());

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(NoUsablePaymentOptionError);
  });

  it("refuses an x402 v1 challenge rather than misreading its price field", async () => {
    // v1 names the price `maxAmountRequired`; reading `amount` off it would be
    // undefined and could only fail confusingly later.
    const v1 = new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": b64({
          x402Version: 1,
          accepts: [{ scheme: "exact", network: "stellar:testnet", maxAmountRequired: "1000" }],
        }),
      },
    });
    const { payer } = makePayer([v1], neverCalledSigner());

    await expect(payer.pay(URL, "1000000")).rejects.toThrow(/Unsupported x402 version 1/);
  });

  it("refuses when the session ceiling for the asset would be exceeded", async () => {
    // ASSET_B's configured ceiling is 500.
    const { payer } = makePayer(
      [response402(challenge([requirement({ asset: ASSET_B, amount: "600" })]))],
      neverCalledSigner(),
    );

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(SessionCeilingExceededError);
  });

  it("refuses a malformed max_amount without issuing any request", async () => {
    const { payer, fetchImpl } = makePayer([response402()], neverCalledSigner());

    await expect(payer.pay(URL, "1e6")).rejects.toThrow();
    expect(fetchImpl.requests.length).toBe(0);
  });
});

describe("pay — settlement accounting", () => {
  it("debits the ledger exactly once on a confirmed settlement", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const { payer } = makePayer(
      [response402(), responsePaid("tx-hash-1")],
      stubSigner(),
      config,
      ledger,
    );

    const result = await payer.pay(URL, "1000000");

    expect(result.paid).toBe(true);
    expect(result.settlement?.transaction).toBe(txHash("tx-hash-1"));
    expect(result.attempts).toBe(1);
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n - 1_000n);
    expect(result.sessionRemaining).toBe((1_000_000n - 1_000n).toString());
  });

  it("accumulates spend across payments and then refuses at the ceiling", async () => {
    const config = testConfig({ assets: `${ASSET_A}:1500` });
    const ledger = testLedger(config);

    const first = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl: scriptedFetch([response402(), responsePaid("tx-1")]),
    });
    await first.pay(URL, "1000000");
    expect(ledger.remainingFor(ASSET_A)).toBe(500n);

    // A second 1000-unit payment would take the total to 2000, over the 1500 cap.
    const second = createPayer({
      config,
      ledger,
      signer: neverCalledSigner(),
      fetchImpl: scriptedFetch([response402()]),
    });
    await expect(second.pay(URL, "1000000")).rejects.toBeInstanceOf(SessionCeilingExceededError);
  });

  it("does not debit when the facilitator rejects the payment", async () => {
    const rejected = new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, error: "over budget", accepts: [] }) },
    });
    const config = testConfig();
    const ledger = testLedger(config);
    const { payer } = makePayer([response402(), rejected], stubSigner(), config, ledger);

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(PaymentRejectedError);
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n);
  });

  it("does not retry a facilitator rejection (it is deterministic)", async () => {
    const rejected = new Response("{}", { status: 403 });
    const signer = stubSigner();
    const { payer, fetchImpl } = makePayer([response402(), rejected], signer);

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(PaymentRejectedError);
    expect(signer.calls).toHaveLength(1);
    expect(fetchImpl.requests.length).toBe(2);
  });
});

describe("pay — settle-failure retry", () => {
  // Roughly one testnet settlement in three returns an empty transaction with
  // NOTHING spent. Retry is the normal path; the accounting must not drift.

  it("retries an empty-transaction settlement and debits only once", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const signer = stubSigner();
    const { payer, fetchImpl } = makePayer(
      [response402(), responseUnsettled(), responsePaid("tx-after-retry")],
      signer,
      config,
      ledger,
    );

    const result = await payer.pay(URL, "1000000");

    expect(result.settlement?.transaction).toBe(txHash("tx-after-retry"));
    expect(result.attempts).toBe(2);
    // Two signed attempts...
    expect(signer.calls).toHaveLength(2);
    expect(fetchImpl.requests.length).toBe(3); // 1 unpaid + 2 paid
    // ...but exactly ONE debit. Debiting per attempt would leave 998_000.
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n - 1_000n);
  });

  it("invokes onRetry hook with attempt and error on retryable settle failure", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const signer = stubSigner();
    const retryCalls: unknown[] = [];
    const fetchImpl = scriptedFetch([
      response402(),
      responseUnsettled(),
      responsePaid("tx-after-retry"),
    ]);
    const payer = createPayer({
      config,
      ledger,
      signer,
      fetchImpl,
      onRetry: (payload) => {
        retryCalls.push(payload);
      },
    });

    await payer.pay(URL, "1000000");

    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0]).toMatchObject({
      attempt: 1,
      operation: "x402PaymentSettleRetry",
      url: URL,
      asset: ASSET_A,
    });
    expect((retryCalls[0] as { error: Error }).error).toBeInstanceOf(Error);
  });

  it("signs a FRESH payload for every attempt rather than replaying one", async () => {
    // Signatures expire in ledgers (~5s each), so a cached payload is a payload
    // that will be rejected. Each call must reach the signer independently.
    const seen: number[] = [];
    const signer = stubSigner(undefined, (_c, i) => seen.push(i));
    const { payer } = makePayer(
      [response402(), responseUnsettled(), responsePaid("tx-2")],
      signer,
    );

    await payer.pay(URL, "1000000");

    expect(seen).toEqual([0, 1]);
    expect(signer.calls[0]).not.toBe(undefined);
  });

  it("gives up after 3 attempts, spending nothing", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const signer = stubSigner();
    const { payer } = makePayer(
      [response402(), responseUnsettled(), responseUnsettled(), responseUnsettled()],
      signer,
      config,
      ledger,
    );

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(SettlementFailedError);
    expect(signer.calls).toHaveLength(3);
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n);
  });

  it("does not return unpaid content when settlement never confirms", async () => {
    // The body was served, but we cannot prove it was paid for. Returning it
    // would let the ledger and reality diverge silently.
    const { payer } = makePayer([
      response402(),
      responseUnsettled("secret content"),
      responseUnsettled("secret content"),
      responseUnsettled("secret content"),
    ]);

    await expect(payer.pay(URL, "1000000")).rejects.toThrow(/nothing was spent/);
  });
});

describe("pay — settle-failure taxonomy (captured live, not inferred)", () => {
  // Every shape below was observed against a local facilitator under RPC
  // contention. The benign failure arrives as an HTTP 402 — NOT a 2xx — so
  // classifying on status alone means the retry loop never runs in production.

  it("RETRIES an HTTP 402 whose settle result has an empty transaction", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const signer = stubSigner();
    const { payer } = makePayer(
      [response402(), responseSettleFailed(), responsePaid("tx-recovered")],
      signer,
      config,
      ledger,
    );

    const result = await payer.pay(URL, "1000000");

    expect(result.settlement?.transaction).toBe(txHash("tx-recovered"));
    expect(result.attempts).toBe(2);
    expect(signer.calls).toHaveLength(2); // signed fresh each time
    // Nothing was spent on the failed attempt, so exactly one debit.
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n - 1_000n);
  });

  it("recovers across two consecutive settle failures", async () => {
    const signer = stubSigner();
    const { payer } = makePayer([
      response402(),
      responseSettleFailed(),
      responseSettleFailed(),
      responsePaid("tx-third-time"),
    ], signer);

    const result = await payer.pay(URL, "1000000");

    expect(result.settlement?.transaction).toBe(txHash("tx-third-time"));
    expect(result.attempts).toBe(3);
    expect(signer.calls).toHaveLength(3);
  });

  it("gives up after 3 settle failures having spent nothing", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const { payer } = makePayer(
      [response402(), responseSettleFailed(), responseSettleFailed(), responseSettleFailed()],
      stubSigner(),
      config,
      ledger,
    );

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(SettlementFailedError);
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n);
  });

  it("does NOT retry when the transaction was submitted and fees were charged", async () => {
    // A non-empty hash means it reached the chain. Retrying burns fees again.
    const config = testConfig();
    const ledger = testLedger(config);
    const signer = stubSigner();
    const { payer } = makePayer(
      [response402(), responseSubmittedButFailed("abc123def456")],
      signer,
      config,
      ledger,
    );

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(PaymentRejectedError);
    expect(signer.calls).toHaveLength(1);
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n);
  });

  it("surfaces the submitted hash so a charged-but-failed payment is traceable", async () => {
    const { payer } = makePayer([response402(), responseSubmittedButFailed("abc123def456")]);

    await expect(payer.pay(URL, "1000000")).rejects.toThrow(/abc123def456/);
  });

  it("does NOT retry a verify-stage rejection (no settle header at all)", async () => {
    const signer = stubSigner();
    const { payer } = makePayer([response402(), responseVerifyRejected("over budget")], signer);

    await expect(payer.pay(URL, "1000000")).rejects.toBeInstanceOf(PaymentRejectedError);
    expect(signer.calls).toHaveLength(1);
  });

  it("carries the facilitator's errorReason into the thrown error", async () => {
    const { payer } = makePayer([response402(), responseSubmittedButFailed()]);

    await expect(payer.pay(URL, "1000000")).rejects.toThrow(
      /settle_exact_stellar_transaction_failed/,
    );
  });
});

describe("pay — selection integrity", () => {
  it("hands the signer exactly ONE cleared option, not the whole challenge", async () => {
    // The official createPaymentPayload re-selects internally, so narrowing is
    // what stops it paying an option the guards never cleared.
    const signer = stubSigner();
    const { payer } = makePayer(
      [
        response402(
          challenge([
            requirement({ asset: ASSET_A, amount: "9000" }),
            requirement({ asset: ASSET_A, amount: "1000" }),
          ]),
        ),
        responsePaid("tx-1"),
      ],
      signer,
    );

    await payer.pay(URL, "1000000");

    expect(signer.calls[0]!.accepts).toHaveLength(1);
    // ...and it is the CHEAPEST option, not accepts[0] (the official default).
    expect(signer.calls[0]!.accepts[0]!.amount).toBe("1000");
  });

  it("preserves resource and extensions on the narrowed challenge", async () => {
    // The official client echoes these into the payload the facilitator verifies.
    const c = challenge();
    c.extensions = { discovery: { listed: true } };
    const signer = stubSigner();
    const { payer } = makePayer([response402(c), responsePaid("tx-1")], signer);

    await payer.pay(URL, "1000000");

    expect(signer.calls[0]!.extensions).toEqual({ discovery: { listed: true } });
    expect(signer.calls[0]!.resource?.url).toBe("https://res.test/paid");
  });

  it("charges the amount of the option it cleared", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const { payer } = makePayer(
      [
        response402(
          challenge([
            requirement({ asset: ASSET_A, amount: "4000" }),
            requirement({ asset: ASSET_A, amount: "2500" }),
          ]),
        ),
        responsePaid("tx-1"),
      ],
      stubSigner(),
      config,
      ledger,
    );

    const result = await payer.pay(URL, "1000000");

    expect(result.settlement?.amount).toBe("2500");
    expect(ledger.remainingFor(ASSET_A)).toBe(1_000_000n - 2_500n);
  });
});

describe("pay — content handling", () => {
  it("truncates oversized text with an explicit marker", async () => {
    const config = testConfig({ maxResponseBytes: "32" });
    const body = "x".repeat(500);
    const paid = new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "X-PAYMENT-RESPONSE": b64({ success: true, transaction: txHash("tx-1") }),
      },
    });
    const { payer } = makePayer([response402(), paid], stubSigner(), config);

    const result = await payer.pay(URL, "1000000");

    expect(result.content.truncated).toBe(true);
    expect(result.content.bytes).toBe(500);
    expect(result.content.text).toContain("[TRUNCATED: showing 32 of 500 bytes]");
  });

  it("does not inline binary content, but still reports the settlement", async () => {
    const paid = new Response(new Uint8Array([0, 1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "X-PAYMENT-RESPONSE": b64({ success: true, transaction: txHash("tx-1") }),
      },
    });
    const { payer } = makePayer([response402(), paid], stubSigner());

    const result = await payer.pay(URL, "1000000");

    expect(result.content.binaryOmitted).toBe(true);
    expect(result.content.text).toBeUndefined();
    expect(result.settlement?.transaction).toBe(txHash("tx-1"));
  });
});

describe("quote — never signs, never touches the chain", () => {
  it("reports the price without invoking the signer", async () => {
    const { payer, fetchImpl } = makePayer([response402()], neverCalledSigner());

    const result = await payer.quote(URL);

    expect(result.requiresPayment).toBe(true);
    expect(result.selected?.amount).toBe("1000");
    expect(result.selected?.asset).toBe(ASSET_A);
    expect(result.payable).toBe(true);
    expect(result.sessionRemaining).toBe("1000000");
    // Exactly one HTTP request, and no signing.
    expect(fetchImpl.requests.length).toBe(1);
  });

  it("reports no-payment-required for a 200", async () => {
    const { payer } = makePayer([new Response("ok", { status: 200 })], neverCalledSigner());

    const result = await payer.quote(URL);

    expect(result.requiresPayment).toBe(false);
    expect(result.payable).toBe(true);
  });

  it("REPORTS a refusal rather than throwing it", async () => {
    // Knowing why a resource is unpayable is the point of asking for a quote.
    const unlisted = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
    const { payer } = makePayer(
      [response402(challenge([requirement({ asset: unlisted })]))],
      neverCalledSigner(),
    );

    const result = await payer.quote(URL);

    expect(result.payable).toBe(false);
    expect(result.refusal).toMatch(/not in allowedAssets/);
    expect(result.offered).toHaveLength(1);
  });

  it("reports unpayable when the price exceeds the remaining session ceiling", async () => {
    const { payer } = makePayer(
      [response402(challenge([requirement({ asset: ASSET_B, amount: "900" })]))],
      neverCalledSigner(),
    );

    const result = await payer.quote(URL);

    expect(result.payable).toBe(false);
    expect(result.refusal).toMatch(/remaining ceiling/);
  });

  it("surfaces the cheapest option when several are offered", async () => {
    const { payer } = makePayer(
      [
        response402(
          challenge([
            requirement({ amount: "8000" }),
            requirement({ amount: "3000" }),
          ]),
        ),
      ],
      neverCalledSigner(),
    );

    const result = await payer.quote(URL);

    expect(result.selected?.amount).toBe("3000");
    expect(result.offered).toHaveLength(2);
  });
});
