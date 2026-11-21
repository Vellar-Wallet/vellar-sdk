import { describe, expect, it, vi } from "vitest";
import {
  checkFacilitatorLiveness,
  compareCommit,
  isReachable,
  parseHealthResponse,
  type HealthResponse,
} from "./health";

const HOSTED_TESTNET_FACILITATOR_URL =
  "https://vellar-facilitator.onrender.com";

describe("isReachable", () => {
  it("reports reachable with a rounded latency on success", async () => {
    const result = await isReachable("https://rpc.example.com", {
      ping: async () => undefined,
    });
    expect(result.reachable).toBe(true);
    if (result.reachable) {
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.latencyMs)).toBe(true);
    }
  });

  it("reports unreachable on a simulated downstream failure", async () => {
    const result = await isReachable("https://rpc.example.com", {
      ping: async () => {
        throw new Error("connection refused");
      },
    });
    expect(result.reachable).toBe(false);
    if (!result.reachable) expect(result.error).toContain("connection refused");
  });

  it("reports unreachable when the endpoint never answers within the timeout", async () => {
    const result = await isReachable("https://rpc.example.com", {
      timeoutMs: 20,
      ping: () => new Promise(() => {}), // never resolves
    });
    expect(result.reachable).toBe(false);
    if (!result.reachable) expect(result.error).toMatch(/timed out/i);
  });

  it("uses the injected clock to measure latency", async () => {
    const timestamps = [100, 115]; // bump: 15ms elapsed on a healthy ping
    let i = 0;
    const result = await isReachable("https://rpc.example.com", {
      now: () => timestamps[i++] ?? 100,
      ping: async () => undefined,
    });
    expect(result.reachable).toBe(true);
    if (result.reachable) expect(result.latencyMs).toBe(15);
  });
});

describe("checkFacilitatorLiveness", () => {
  it("reports the hosted testnet facilitator as healthy", async () => {
    let requestedUrl = "";
    const result = await checkFacilitatorLiveness(
      HOSTED_TESTNET_FACILITATOR_URL,
      {
        fetch: async (url) => {
          requestedUrl = String(url);
          return new Response(
            JSON.stringify({
              status: "ok",
              channelPool: { available: 10 },
              unverifiableEntries: 0,
            }),
            { status: 200 },
          );
        },
      },
    );

    expect(requestedUrl).toBe(
      `${HOSTED_TESTNET_FACILITATOR_URL}/health`,
    );
    expect(result).toMatchObject({
      state: "reachable-healthy",
      health: { status: "ok", channelPool: { available: 10 } },
    });
  });

  it("reports a reachable facilitator with no channels as unhealthy", async () => {
    const result = await checkFacilitatorLiveness(
      HOSTED_TESTNET_FACILITATOR_URL,
      {
        fetch: async () =>
          new Response(
            JSON.stringify({
              status: "ok",
              channelPool: { available: 0 },
            }),
            { status: 200 },
          ),
      },
    );

    expect(result).toMatchObject({
      state: "reachable-unhealthy",
      reason: expect.stringContaining("channelPool.available is 0"),
    });
  });

  it("reports network failures as unreachable", async () => {
    const result = await checkFacilitatorLiveness(
      HOSTED_TESTNET_FACILITATOR_URL,
      {
        fetch: async () => {
          throw new Error("connection refused");
        },
      },
    );

    expect(result).toMatchObject({
      state: "unreachable",
      error: "connection refused",
    });
  });

  it("uses the 5-second default timeout without a cold-start grace period", async () => {
    vi.useFakeTimers();
    try {
      let requestedUrl = "";
      let signal: AbortSignal | null | undefined;
      const resultPromise = checkFacilitatorLiveness(
        HOSTED_TESTNET_FACILITATOR_URL,
        {
          fetch: (url, init) => {
            requestedUrl = String(url);
            signal = init?.signal;
            return new Promise<Response>(() => {});
          },
        },
      );

      let settled = false;
      void resultPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(resultPromise).resolves.toMatchObject({
        state: "unreachable",
        error: expect.stringContaining("5000ms"),
      });
      expect(requestedUrl).toBe(
        `${HOSTED_TESTNET_FACILITATOR_URL}/health`,
      );
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("parseHealthResponse", () => {
  it("parses a complete healthy response with unverifiableEntries omitted", () => {
    const raw = {
      status: "ok",
      catalogSize: 12,
      reverifyPending: 0,
      channelPool: { available: 10 },
      commit: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      // unverifiableEntries intentionally omitted: documented as sometimes absent
    };
    const parsed = parseHealthResponse(raw);
    expect(parsed).toEqual({ ...raw, unverifiableEntries: 0 });
  });

  it("defaults the documented-optional unverifiableEntries field when omitted", () => {
    const raw = {
      status: "ok",
      catalogSize: 0,
      reverifyPending: 0,
      channelPool: { available: 5 },
      commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    };
    const parsed = parseHealthResponse(raw);
    expect(parsed).toEqual({ ...raw, unverifiableEntries: 0 });
  });

  it("throws a descriptive error when a guaranteed field is missing", () => {
    const raw = {
      status: "ok",
      catalogSize: 0,
      reverifyPending: 0,
      channelPool: { available: 5 },
    };
    expect(() => parseHealthResponse(raw)).toThrow(/commit/i);
  });
});

describe("compareCommit", () => {
  const health: HealthResponse = {
    status: "ok",
    catalogSize: 12,
    reverifyPending: 0,
    channelPool: { available: 10 },
    commit: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    unverifiableEntries: 0,
  };

  it("reports a match when the live commit equals the expected commit", () => {
    const result = compareCommit(
      health.commit,
      "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    );
    expect(result.matches).toBe(true);
    expect(result.actual).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    expect(result.expected).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
  });

  it("clearly reports a mismatch rather than silently ignoring it", () => {
    const result = compareCommit(
      health.commit,
      "0000000000000000000000000000000000000000",
    );
    expect(result.matches).toBe(false);
    expect(result.actual).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    expect(result.expected).toBe("0000000000000000000000000000000000000000");
  });
});
