import { describe, expect, it, vi } from "vitest";
import {
  buildPaymentCompletedEvent,
  createMemorySink,
  sanitizeResourceId,
  toJSON,
  withPaymentTelemetry,
  type X402PaymentCompletedEvent,
  type X402ResponseLike,
} from "./x402-telemetry";

const TOKEN = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const PAYER = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const TX = "1f0a6c621f0a6c631f0a6c641f0a6c651f0a6c661f0a6c671f0a6c681f0a6c69";

/** A settled x402 result, as `wallet.x402.fetch()` would resolve it. */
function paidResult(over: Partial<X402ResponseLike> = {}): X402ResponseLike {
  return {
    response: { status: 200 },
    paid: true,
    settlement: {
      transaction: TX,
      payer: PAYER,
      asset: TOKEN,
      amount: 1_000_000n,
      network: "testnet",
    },
    ...over,
  };
}

/** A resource that needed no payment. */
const unpaidResult: X402ResponseLike = { response: { status: 200 }, paid: false };

const frozenClock = () => 1_700_000_000_000;

describe("sanitizeResourceId", () => {
  it("keeps origin and path but drops the query string, where API keys live", () => {
    expect(sanitizeResourceId("https://api.test/v1/report?apiKey=secret&x=1")).toBe(
      "https://api.test/v1/report",
    );
  });

  it("drops the fragment too", () => {
    expect(sanitizeResourceId("https://api.test/v1/report#section")).toBe(
      "https://api.test/v1/report",
    );
  });

  it("records only the origin in origin mode", () => {
    expect(sanitizeResourceId("https://api.test/v1/report?k=v", "origin")).toBe("https://api.test");
  });

  it("records the URL verbatim in full mode, which is opt-in", () => {
    const url = "https://api.test/v1/report?apiKey=secret";
    expect(sanitizeResourceId(url, "full")).toBe(url);
  });

  it("still strips query and fragment from a URL that does not parse", () => {
    // An unparseable URL is not a reason to log a raw secret.
    expect(sanitizeResourceId("not a url?token=secret")).toBe("not a url");
  });
});

describe("buildPaymentCompletedEvent", () => {
  it("carries the resource id and amount the issue asks for", () => {
    const event = buildPaymentCompletedEvent("https://api.test/v1/report", paidResult(), {
      now: frozenClock,
    });

    expect(event).toMatchObject({
      type: "x402.payment.completed",
      resourceId: "https://api.test/v1/report",
      amount: 1_000_000n,
    });
  });

  it("includes the settlement details needed to reconcile against chain", () => {
    const event = buildPaymentCompletedEvent("https://api.test/r", paidResult(), {
      now: frozenClock,
    });

    expect(event).toMatchObject({
      asset: TOKEN,
      network: "testnet",
      transaction: TX,
      payer: PAYER,
      status: 200,
      timestamp: 1_700_000_000_000,
    });
  });

  it("emits nothing when the resource needed no payment", () => {
    // A cache hit is not a payment; counting it would inflate every
    // "payments made" metric built on this event.
    expect(buildPaymentCompletedEvent("https://api.test/r", unpaidResult)).toBeUndefined();
  });

  it("emits nothing when paid is true but no settlement was returned", () => {
    const noSettlement = paidResult({ settlement: undefined });
    expect(buildPaymentCompletedEvent("https://api.test/r", noSettlement)).toBeUndefined();
  });

  it("keeps a stroop-precision amount exact, beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    const event = buildPaymentCompletedEvent(
      "https://api.test/r",
      paidResult({ settlement: { ...paidResult().settlement!, amount: huge } }),
      { now: frozenClock },
    );

    expect(event?.amount).toBe(huge);
    // The lossy alternative, for contrast: converting to Number rounds this
    // value down, so a Number-typed amount would silently misreport the spend.
    expect(BigInt(Number(huge))).not.toBe(huge);
  });

  it("omits durationMs entirely when it was not measured", () => {
    const event = buildPaymentCompletedEvent("https://api.test/r", paidResult(), {
      now: frozenClock,
    });
    expect(event).not.toHaveProperty("durationMs");
  });
});

describe("toJSON", () => {
  it("renders the bigint amount as a decimal string, since JSON has no bigint", () => {
    const event = buildPaymentCompletedEvent("https://api.test/r", paidResult(), {
      now: frozenClock,
    })!;

    expect(toJSON(event).amount).toBe("1000000");
    // The trap this exists to remove.
    expect(() => JSON.stringify(event)).toThrow(TypeError);
    expect(() => JSON.stringify(toJSON(event))).not.toThrow();
  });

  it("round-trips a huge amount without precision loss", () => {
    const huge = 9_007_199_254_740_993n;
    const event = buildPaymentCompletedEvent(
      "https://api.test/r",
      paidResult({ settlement: { ...paidResult().settlement!, amount: huge } }),
      { now: frozenClock },
    )!;

    expect(BigInt(toJSON(event).amount as string)).toBe(huge);
  });
});

describe("withPaymentTelemetry", () => {
  it("emits exactly one event per completed payment, and returns the result untouched", async () => {
    const { sink, events } = createMemorySink();
    const result = paidResult();
    const fetchImpl = vi.fn(async () => result);

    const wrapped = withPaymentTelemetry(fetchImpl, { sink, now: frozenClock });
    const returned = await wrapped("https://api.test/v1/report?key=secret", {});

    expect(returned).toBe(result);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      resourceId: "https://api.test/v1/report",
      amount: 1_000_000n,
    });
  });

  it("emits nothing for a resource that needed no payment", async () => {
    const { sink, events } = createMemorySink();
    const wrapped = withPaymentTelemetry(async () => unpaidResult, { sink });

    await wrapped("https://api.test/free", {});

    expect(events).toEqual([]);
  });

  it("returns the original fetch untouched when no sink is configured", () => {
    const fetchImpl = vi.fn(async () => paidResult());
    expect(withPaymentTelemetry(fetchImpl, {})).toBe(fetchImpl);
  });

  it("passes url and init through unchanged", async () => {
    const { sink } = createMemorySink();
    const fetchImpl = vi.fn(async () => paidResult());
    const init = { maxAmount: 5_000_000n };

    await withPaymentTelemetry(fetchImpl, { sink })("https://api.test/r", init);

    expect(fetchImpl).toHaveBeenCalledWith("https://api.test/r", init);
  });

  it("records how long the paid fetch took", async () => {
    const { sink, events } = createMemorySink();
    let t = 1000;
    const now = () => t;
    const wrapped = withPaymentTelemetry(
      async () => {
        t += 250;
        return paidResult();
      },
      { sink, now },
    );

    await wrapped("https://api.test/r", {});

    expect(events[0].durationMs).toBe(250);
  });

  it("honours resourceIdMode", async () => {
    const { sink, events } = createMemorySink();
    const wrapped = withPaymentTelemetry(async () => paidResult(), {
      sink,
      resourceIdMode: "origin",
    });

    await wrapped("https://api.test/v1/report", {});

    expect(events[0].resourceId).toBe("https://api.test");
  });
});

describe("withPaymentTelemetry — telemetry must never break a payment", () => {
  it("still returns the settled result when the sink throws synchronously", async () => {
    const result = paidResult();
    const onError = vi.fn();
    const wrapped = withPaymentTelemetry(async () => result, {
      sink: () => {
        throw new Error("analytics down");
      },
      onError,
    });

    // The payment already moved real money on-chain. A broken sink cannot
    // be allowed to turn that into a rejected call.
    await expect(wrapped("https://api.test/r", {})).resolves.toBe(result);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe("analytics down");
  });

  it("still returns the settled result when an async sink rejects", async () => {
    const result = paidResult();
    const onError = vi.fn();
    const wrapped = withPaymentTelemetry(async () => result, {
      sink: async () => {
        throw new Error("network down");
      },
      onError,
    });

    await expect(wrapped("https://api.test/r", {})).resolves.toBe(result);
    // The rejection is caught asynchronously; let the microtask queue drain.
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });

  it("does not produce an unhandled rejection from a rejecting sink", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const wrapped = withPaymentTelemetry(async () => paidResult(), {
        sink: async () => {
          throw new Error("boom");
        },
      });

      await wrapped("https://api.test/r", {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("survives an onError that itself throws", async () => {
    const result = paidResult();
    const wrapped = withPaymentTelemetry(async () => result, {
      sink: () => {
        throw new Error("sink");
      },
      onError: () => {
        throw new Error("handler");
      },
    });

    await expect(wrapped("https://api.test/r", {})).resolves.toBe(result);
  });

  it("does not await a slow sink, so telemetry adds no latency to a settled payment", async () => {
    let released!: () => void;
    const blocked = new Promise<void>((resolve) => (released = resolve));

    const wrapped = withPaymentTelemetry(async () => paidResult(), {
      sink: () => blocked,
    });

    // Resolves while the sink is still pending.
    await expect(wrapped("https://api.test/r", {})).resolves.toBeDefined();
    released();
  });

  it("emits nothing and rethrows when the payment itself fails", async () => {
    const { sink, events } = createMemorySink();
    const boom = new Error("payment rejected");
    const wrapped = withPaymentTelemetry(
      async () => {
        throw boom;
      },
      { sink },
    );

    await expect(wrapped("https://api.test/r", {})).rejects.toBe(boom);
    expect(events).toEqual([]);
  });
});

describe("createMemorySink", () => {
  it("totals spend per asset across recorded payments", async () => {
    const { sink, totalFor } = createMemorySink();
    const wrapped = withPaymentTelemetry(async () => paidResult(), { sink });

    await wrapped("https://api.test/a", {});
    await wrapped("https://api.test/b", {});

    expect(totalFor(TOKEN)).toBe(2_000_000n);
    expect(totalFor("COTHER")).toBe(0n);
  });
});

describe("event shape", () => {
  it("carries no request headers or bodies, so PAYMENT-SIGNATURE cannot leak", () => {
    const event = buildPaymentCompletedEvent("https://api.test/r", paidResult(), {
      now: frozenClock,
      durationMs: 12,
    })!;

    const keys = Object.keys(event) as Array<keyof X402PaymentCompletedEvent>;
    expect(keys.sort()).toEqual(
      [
        "amount",
        "asset",
        "durationMs",
        "network",
        "payer",
        "resourceId",
        "status",
        "timestamp",
        "transaction",
        "type",
      ].sort(),
    );

    // Nothing that could carry the signed authorization or a credential.
    const serialized = JSON.stringify(toJSON(event));
    expect(serialized).not.toMatch(/PAYMENT-SIGNATURE/i);
    expect(serialized).not.toMatch(/header|body|authorization|cookie/i);
  });
});
