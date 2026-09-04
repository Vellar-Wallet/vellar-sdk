import { describe, expect, it, vi } from "vitest";
import {
  createCorrelatedFetch,
  generateCorrelationId,
  resolveCorrelationId,
} from "./correlation-id";

describe("correlation-id (Issue #248)", () => {
  it("generates a unique correlation ID string", () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(0);
    expect(id1).not.toBe(id2);
  });

  it("resolves explicit ID over configured default", () => {
    expect(resolveCorrelationId("explicit-123", "default-456")).toBe("explicit-123");
    expect(resolveCorrelationId(undefined, () => "dynamic-789")).toBe("dynamic-789");
  });

  it("attaches x-correlation-id header to outgoing fetch requests", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"));
    const correlatedFetch = createCorrelatedFetch(fetchMock, "test-trace-id");

    await correlatedFetch("https://api.example.com/test");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("x-correlation-id")).toBe("test-trace-id");
  });

  it("preserves explicit correlation ID passed in request headers", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"));
    const correlatedFetch = createCorrelatedFetch(fetchMock, "fallback-id");

    await correlatedFetch("https://api.example.com/test", {
      headers: { "x-correlation-id": "custom-override-id" },
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("x-correlation-id")).toBe("custom-override-id");
  });
});
