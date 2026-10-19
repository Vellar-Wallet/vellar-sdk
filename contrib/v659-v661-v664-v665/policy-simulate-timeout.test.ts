// Issue #659 — policy simulate when the dry-run call itself never answers.
// Drives the REAL createPolicyClient underneath; only fetch is stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPolicyClient } from "../../src/policy-client.js";
import { PolicyApiError } from "../../src/policy-types.js";
import {
  DEFAULT_SIMULATE_TIMEOUT_MS,
  PolicySimulateTimeoutError,
  createPolicyClientWithSimulateTimeout,
} from "./policy-simulate-timeout.js";

const API = "https://api.test";

/** A fetch that never answers on its own, but honours its abort signal. */
function hangingFetch() {
  const aborted: string[] = [];
  const fetchImpl = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted.push(String(input));
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  );
  return { fetchImpl: fetchImpl as unknown as typeof fetch, aborted, calls: fetchImpl };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("simulate with a timeout", () => {
  it("UNGUARDED src: a hanging RPC leaves simulate pending forever", async () => {
    const { fetchImpl } = hangingFetch();
    const client = createPolicyClient({ apiUrl: API, network: "testnet", fetch: fetchImpl });

    let settled = false;
    void client.simulate("p1", "CWALLET").finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(settled).toBe(false);
  });

  it("rejects with PolicySimulateTimeoutError after the timeout and aborts the request", async () => {
    const { fetchImpl, aborted } = hangingFetch();
    const client = createPolicyClientWithSimulateTimeout({
      apiUrl: API,
      network: "testnet",
      fetch: fetchImpl,
      simulateTimeoutMs: 5_000,
    });

    const pending = client.simulate("p1", "CWALLET").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(aborted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    const err = await pending;
    expect(err).toBeInstanceOf(PolicySimulateTimeoutError);
    expect(err).not.toBeInstanceOf(PolicyApiError);
    expect(err).toMatchObject({ policyId: "p1", timeoutMs: 5_000 });
    expect(aborted).toEqual([`${API}/policies/p1/simulate`]);
  });

  it(`defaults to ${DEFAULT_SIMULATE_TIMEOUT_MS} ms`, async () => {
    const { fetchImpl } = hangingFetch();
    const client = createPolicyClientWithSimulateTimeout({
      apiUrl: API,
      network: "testnet",
      fetch: fetchImpl,
    });

    const pending = client.simulate("p1", "CWALLET").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_SIMULATE_TIMEOUT_MS);

    expect(await pending).toBeInstanceOf(PolicySimulateTimeoutError);
  });

  it("a simulation FAILURE result resolves as before — it is not a timeout", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ ok: false, error: "HostError: Error(Contract, #3)" }),
    ) as unknown as typeof fetch;
    const client = createPolicyClientWithSimulateTimeout({
      apiUrl: API,
      network: "testnet",
      fetch: fetchImpl,
      simulateTimeoutMs: 5_000,
    });

    const result = await client.simulate("p1", "CWALLET");

    expect(result).toEqual({ ok: false, error: "HostError: Error(Contract, #3)" });
  });

  it("an HTTP error stays a PolicyApiError with its status", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: "simulation backend unavailable" }, 503),
    ) as unknown as typeof fetch;
    const client = createPolicyClientWithSimulateTimeout({
      apiUrl: API,
      network: "testnet",
      fetch: fetchImpl,
      simulateTimeoutMs: 5_000,
    });

    const err = await client.simulate("p1", "CWALLET").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PolicyApiError);
    expect(err).not.toBeInstanceOf(PolicySimulateTimeoutError);
    expect((err as PolicyApiError).status).toBe(503);
  });

  it("happy path: a timely success resolves and clears its timer", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true, minResourceFee: "1200" })) as unknown as typeof fetch;
    const client = createPolicyClientWithSimulateTimeout({
      apiUrl: API,
      network: "testnet",
      fetch: fetchImpl,
      simulateTimeoutMs: 5_000,
    });

    await expect(client.simulate("p1", "CWALLET")).resolves.toEqual({
      ok: true,
      minResourceFee: "1200",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("only simulate is timed; other methods are the unmodified client", async () => {
    const { fetchImpl, calls } = hangingFetch();
    const client = createPolicyClientWithSimulateTimeout({
      apiUrl: API,
      network: "testnet",
      fetch: fetchImpl,
      simulateTimeoutMs: 5_000,
    });

    void client.listTemplates();
    await vi.advanceTimersByTimeAsync(0);
    const init = (calls.mock.calls[0] as unknown[])[1] as RequestInit | undefined;
    expect(init?.signal).toBeUndefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid simulateTimeoutMs (%s) at construction",
    (ms) => {
      expect(() =>
        createPolicyClientWithSimulateTimeout({ apiUrl: API, network: "testnet", simulateTimeoutMs: ms }),
      ).toThrow(RangeError);
    },
  );
});
