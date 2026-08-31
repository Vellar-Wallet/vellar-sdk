import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_DEPLOY_TIMEOUTS,
  PolicyDeployTimeoutError,
  createTimedPolicyDeployClient,
} from "./policy-deploy-timeout";

/** A mock fetch that resolves after `delayMs` with a JSON body, respecting
 * the abort signal the way the real global fetch does. */
function createDelayedJsonFetch(delayMs: number, body: unknown): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify(body))), delayMs);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    })) as typeof fetch;
}

describe("createTimedPolicyDeployClient — timeout triggers as configured", () => {
  it("simulate() resolves normally when the response arrives inside the budget", async () => {
    const client = createTimedPolicyDeployClient({
      apiUrl: "https://api.example.com",
      fetch: createDelayedJsonFetch(10, { ok: true, minResourceFee: "100" }),
      timeouts: { simulate: 200 },
    });
    const result = await client.simulate("policy-1", "GWALLET1");
    expect(result).toEqual({ ok: true, minResourceFee: "100" });
  });

  it("simulate() throws PolicyDeployTimeoutError when the response exceeds its budget", async () => {
    const client = createTimedPolicyDeployClient({
      apiUrl: "https://api.example.com",
      fetch: createDelayedJsonFetch(1000, { ok: true }),
      timeouts: { simulate: 20 },
    });
    await expect(client.simulate("policy-1", "GWALLET1")).rejects.toThrow(PolicyDeployTimeoutError);
  });

  it("deployInstance() respects its own configured budget independent of simulate", async () => {
    const client = createTimedPolicyDeployClient({
      apiUrl: "https://api.example.com",
      fetch: createDelayedJsonFetch(1000, { contractId: "C123" }),
      timeouts: { simulate: 5000, deployInstance: 20 },
    });
    await expect(client.deployInstance("policy-1", "GWALLET1")).rejects.toThrow(
      PolicyDeployTimeoutError,
    );
  });

  it("recordDeployment() succeeds within its budget", async () => {
    const client = createTimedPolicyDeployClient({
      apiUrl: "https://api.example.com",
      fetch: createDelayedJsonFetch(10, { policy: { id: "p1" } }),
      timeouts: { recordDeployment: 500 },
    });
    await expect(client.recordDeployment("policy-1", "tx-hash")).resolves.toEqual({
      policy: { id: "p1" },
    });
  });

  it("falls back to DEFAULT_POLICY_DEPLOY_TIMEOUTS for any budget not overridden", async () => {
    const client = createTimedPolicyDeployClient({
      apiUrl: "https://api.example.com",
      fetch: createDelayedJsonFetch(10, { ok: true }),
      timeouts: { simulate: 50 },
    });
    // deployInstance/recordDeployment keep their defaults; a fast mock still
    // resolves well inside DEFAULT_POLICY_DEPLOY_TIMEOUTS.deployInstance.
    expect(DEFAULT_POLICY_DEPLOY_TIMEOUTS.deployInstance).toBeGreaterThan(10);
    await expect(client.deployInstance("policy-1", "GWALLET1")).resolves.toBeDefined();
  });

  it("the timeout error names the path and configured timeout", async () => {
    const client = createTimedPolicyDeployClient({
      apiUrl: "https://api.example.com",
      fetch: createDelayedJsonFetch(1000, {}),
      timeouts: { simulate: 15 },
    });
    await expect(client.simulate("policy-42", "GWALLET1")).rejects.toMatchObject({
      name: "PolicyDeployTimeoutError",
      path: "/policy-42/simulate",
      timeoutMs: 15,
    });
  });

  it("propagates a non-timeout error unchanged", async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error("DNS failure");
    }) as typeof fetch;
    const client = createTimedPolicyDeployClient({
      apiUrl: "https://api.example.com",
      fetch: failingFetch,
    });
    await expect(client.simulate("policy-1", "GWALLET1")).rejects.toThrow("DNS failure");
  });
});
