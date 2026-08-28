// Tests for the x402 tracing module — span hooks, trace context, and error paths.

import { describe, expect, it, vi } from "vitest";
import {
  generateTraceId,
  tracedSpan,
  type SpanName,
  type X402TraceContext,
  type X402TracingHooks,
} from "./x402-tracing";

// ── helpers ────────────────────────────────────────────────────────────────

const noopTrace: X402TraceContext = { traceId: "test-trace-1" };

function collectHooks() {
  const startNames: SpanName[] = [];
  const endNames: SpanName[] = [];
  const endOk: boolean[] = [];
  const endErrors: (Error | undefined)[] = [];
  const hooks: X402TracingHooks = {
    onSpanStart: (e) => startNames.push(e.name),
    onSpanEnd: (e) => {
      endNames.push(e.name);
      endOk.push(e.ok);
      endErrors.push(e.error);
    },
  };
  return { hooks, startNames, endNames, endOk, endErrors };
}

// ── generateTraceId ────────────────────────────────────────────────────────

describe("generateTraceId", () => {
  it("returns a string", () => {
    expect(typeof generateTraceId()).toBe("string");
  });

  it("generates unique ids on successive calls", () => {
    const a = generateTraceId();
    const b = generateTraceId();
    expect(a).not.toBe(b);
  });
});

// ── tracedSpan — no-op path ────────────────────────────────────────────────

describe("tracedSpan — no hooks", () => {
  it("calls fn and returns its value without error", async () => {
    const result = await tracedSpan(undefined, "x402.request", noopTrace, async () => 42);
    expect(result).toBe(42);
  });

  it("propagates errors from fn", async () => {
    await expect(
      tracedSpan(undefined, "x402.request", noopTrace, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

// ── tracedSpan — success path ──────────────────────────────────────────────

describe("tracedSpan — success path", () => {
  it("calls onSpanStart before fn and onSpanEnd after", async () => {
    const { hooks, startNames, endNames, endOk, endErrors } = collectHooks();
    const result = await tracedSpan(hooks, "x402.decode-requirements", noopTrace, async () => "ok");
    expect(result).toBe("ok");
    expect(startNames).toEqual(["x402.decode-requirements"]);
    expect(endNames).toEqual(["x402.decode-requirements"]);
    expect(endOk).toEqual([true]);
    expect(endErrors).toEqual([undefined]);
  });

  it("includes meta in span events when provided", async () => {
    const metaReceived: Record<string, unknown>[] = [];
    const hooks: X402TracingHooks = {
      onSpanStart: (e) => {
        if (e.meta) metaReceived.push(e.meta);
      },
    };
    await tracedSpan(hooks, "x402.request", noopTrace, async () => {}, { url: "https://example.com" });
    expect(metaReceived).toEqual([{ url: "https://example.com" }]);
  });

  it("passes the trace context through", async () => {
    const trace: X402TraceContext = { traceId: "custom-id", attributes: { userId: "u1" } };
    const traceIds: string[] = [];
    const hooks: X402TracingHooks = {
      onSpanStart: (e) => traceIds.push(e.trace.traceId),
    };
    await tracedSpan(hooks, "x402.build-payment", trace, async () => {});
    expect(traceIds).toEqual(["custom-id"]);
  });
});

// ── tracedSpan — error path ────────────────────────────────────────────────

describe("tracedSpan — error path", () => {
  it("calls onSpanEnd with ok=false and the error", async () => {
    const { hooks, endNames, endOk, endErrors } = collectHooks();
    const cause = new Error("sign failed");
    await expect(
      tracedSpan(hooks, "x402.sign-auth-entry", noopTrace, async () => {
        throw cause;
      }),
    ).rejects.toThrow("sign failed");
    expect(endNames).toEqual(["x402.sign-auth-entry"]);
    expect(endOk).toEqual([false]);
    expect(endErrors).toEqual([cause]);
  });

  it("re-throws the original error", async () => {
    const { hooks } = collectHooks();
    const original = new TypeError("bad input");
    await expect(
      tracedSpan(hooks, "x402.select-requirements", noopTrace, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it("wraps non-Error thrown values", async () => {
    const { hooks, endOk, endErrors } = collectHooks();
    await expect(
      tracedSpan(hooks, "x402.paid-retry", noopTrace, async () => {
        throw "string error";
      }),
    ).rejects.toBe("string error");
    expect(endOk).toEqual([false]);
    expect(endErrors[0]).toBeInstanceOf(Error);
    expect(endErrors[0]!.message).toBe("string error");
  });
});

// ── tracedSpan — async timing ──────────────────────────────────────────────

describe("tracedSpan — duration", () => {
  it("records positive durationMs", async () => {
    let recordedDuration = -1;
    const hooks: X402TracingHooks = {
      onSpanEnd: (e) => {
        recordedDuration = e.durationMs;
      },
    };
    await tracedSpan(hooks, "x402.read-settlement", noopTrace, async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(recordedDuration).toBeGreaterThanOrEqual(5);
  });
});

// ── full flow trace capture ────────────────────────────────────────────────

describe("full x402 flow trace capture", () => {
  it("captures all span phases in order for a complete payment flow", async () => {
    const startNames: SpanName[] = [];
    const endNames: SpanName[] = [];
    const hooks: X402TracingHooks = {
      onSpanStart: (e) => startNames.push(e.name),
      onSpanEnd: (e) => endNames.push(e.name),
    };

    // Simulate the full x402 flow by calling tracedSpan in order
    const trace: X402TraceContext = { traceId: "full-flow-test" };

    // 1. Initial request
    await tracedSpan(hooks, "x402.request", trace, async () => "402");
    // 2. Decode requirements
    await tracedSpan(hooks, "x402.decode-requirements", trace, async () => ({}));
    // 3. Select requirements
    await tracedSpan(hooks, "x402.select-requirements", trace, async () => ({}));
    // 4. Build payment
    await tracedSpan(hooks, "x402.build-payment", trace, async () => {
      // 4a. Sign auth entry (nested inside build-payment)
      await tracedSpan(hooks, "x402.sign-auth-entry", trace, async () => "signed-xdr");
      return { header: "base64", amount: 1000000n };
    });
    // 5. Paid retry
    await tracedSpan(hooks, "x402.paid-retry", trace, async () => "200");
    // 6. Read settlement
    await tracedSpan(hooks, "x402.read-settlement", trace, async () => ({ transaction: "abc" }));

    expect(startNames).toEqual([
      "x402.request",
      "x402.decode-requirements",
      "x402.select-requirements",
      "x402.build-payment",
      "x402.sign-auth-entry",
      "x402.paid-retry",
      "x402.read-settlement",
    ]);
    // End order: inner spans end before outer spans (sign-auth-entry before build-payment)
    expect(endNames).toEqual([
      "x402.request",
      "x402.decode-requirements",
      "x402.select-requirements",
      "x402.sign-auth-entry",
      "x402.build-payment",
      "x402.paid-retry",
      "x402.read-settlement",
    ]);
    // All start names appear in ends
    expect(startNames.sort()).toEqual(endNames.sort());
  });

  it("captures error spans in order and still records end for earlier spans", async () => {
    const events: string[] = [];
    const hooks: X402TracingHooks = {
      onSpanStart: (e) => events.push(`start:${e.name}`),
      onSpanEnd: (e) => events.push(`end:${e.name}:${e.ok}`),
    };

    const trace: X402TraceContext = { traceId: "error-flow-test" };

    await tracedSpan(hooks, "x402.request", trace, async () => "402");
    await tracedSpan(hooks, "x402.decode-requirements", trace, async () => ({}));
    await expect(
      tracedSpan(hooks, "x402.select-requirements", trace, async () => {
        throw new Error("no usable option");
      }),
    ).rejects.toThrow("no usable option");

    expect(events).toEqual([
      "start:x402.request",
      "end:x402.request:true",
      "start:x402.decode-requirements",
      "end:x402.decode-requirements:true",
      "start:x402.select-requirements",
      "end:x402.select-requirements:false",
    ]);
  });

  it("propagates the same trace context to all spans", async () => {
    const traceIds: string[] = [];
    const trace: X402TraceContext = { traceId: "propagation-test" };
    const hooks: X402TracingHooks = {
      onSpanStart: (e) => traceIds.push(e.trace.traceId),
    };

    await tracedSpan(hooks, "x402.request", trace, async () => {});
    await tracedSpan(hooks, "x402.build-payment", trace, async () => {});
    await tracedSpan(hooks, "x402.paid-retry", trace, async () => {});

    expect(traceIds).toEqual(["propagation-test", "propagation-test", "propagation-test"]);
  });
});
