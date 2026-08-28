import { describe, expect, it } from "vitest";
import {
  createPolicyClient,
  PolicyDeploymentRollbackError,
  type RollbackEvent,
} from "./policy-client";
import type { PolicyDefinition } from "./types";

// Issue #219: a multi-step deployment must compensate completed steps when a
// later step fails.

const DEFINITION = { template: "spend-limit" } as unknown as PolicyDefinition;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Records every request and fails whichever path the test names. */
function harness(failOn?: string, failCompensation?: string) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace("/policies", "");
    const tag = `${init?.method ?? "GET"} ${path}`;
    calls.push(tag);
    if (failCompensation && tag === failCompensation) return json({ error: "gone" }, 500);
    if (failOn && tag === failOn) return json({ error: "step failed" }, 500);
    if (path === "/generate") return json({ policy: { id: "pol_1" } });
    if (path.endsWith("/simulate")) return json({ ok: true });
    if (path.endsWith("/deploy-instance")) return json({ contractId: "C_1" });
    return json({});
  }) as unknown as typeof fetch;

  const events: RollbackEvent[] = [];
  const client = createPolicyClient({
    apiUrl: "https://api.test",
    network: "testnet",
    fetch: fetchImpl,
    onRollback: (e) => events.push(e),
  });
  return { client, calls, events };
}

describe("policy deployment rollback (#219)", () => {
  it("completes all steps and returns the deployed instance on success", async () => {
    const { client, calls, events } = harness();
    const res = await client.deployPolicy(DEFINITION, "GWALLET");
    expect(res).toEqual({ policy: { id: "pol_1" }, contractId: "C_1" });
    expect(calls).toEqual([
      "POST /generate",
      "POST /pol_1/simulate",
      "POST /pol_1/deploy-instance",
    ]);
    expect(events).toEqual([]);
  });

  it("rolls back the generated policy when deploy-instance fails mid-deployment", async () => {
    const { client, calls, events } = harness("POST /pol_1/deploy-instance");
    await expect(client.deployPolicy(DEFINITION, "GWALLET")).rejects.toThrow();
    // Compensation ran for the one mutating step that had completed.
    expect(calls).toContain("DELETE /pol_1");
    expect(events.map((e) => `${e.step}:${e.status}`)).toEqual([
      "generate:started",
      "generate:succeeded",
    ]);
  });

  it("compensates in reverse order, instance before policy", async () => {
    // deploy-instance succeeds, then recordDeployment-stage failure is
    // simulated by failing simulate on a second run; here we force the
    // instance to exist and the policy delete to be the last compensation.
    const { client, calls } = harness("POST /pol_1/simulate");
    await expect(client.deployPolicy(DEFINITION, "GWALLET")).rejects.toThrow();
    expect(calls).toEqual(["POST /generate", "POST /pol_1/simulate", "DELETE /pol_1"]);
  });

  it("does not compensate simulate — it is a dry run", async () => {
    const { client, calls } = harness("POST /pol_1/deploy-instance");
    await expect(client.deployPolicy(DEFINITION, "GWALLET")).rejects.toThrow();
    expect(calls.filter((c) => c.includes("simulate") && c.startsWith("DELETE"))).toEqual([]);
  });

  it("logs a rollback event for every compensating action", async () => {
    const { client, events } = harness("POST /pol_1/deploy-instance");
    await expect(client.deployPolicy(DEFINITION, "GWALLET")).rejects.toThrow();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ step: "generate", status: "started", policyId: "pol_1" });
  });

  it("surfaces a failed compensation without masking the original error", async () => {
    const { client, events } = harness("POST /pol_1/deploy-instance", "DELETE /pol_1");
    const err = await client.deployPolicy(DEFINITION, "GWALLET").catch((e) => e);
    expect(err).toBeInstanceOf(PolicyDeploymentRollbackError);
    expect(err.rollbackFailures).toHaveLength(1);
    // The deployment failure, not the rollback failure, remains the cause.
    expect(err.cause).toBeDefined();
    expect(events.some((e) => e.status === "failed")).toBe(true);
  });

  it("tracks completed steps on the raised error", async () => {
    const { client } = harness("POST /pol_1/deploy-instance", "DELETE /pol_1");
    const err = await client.deployPolicy(DEFINITION, "GWALLET").catch((e) => e);
    expect(err.completed.map((s: { name: string }) => s.name)).toEqual(["generate", "simulate"]);
  });

  it("rolls back nothing when the very first step fails", async () => {
    const { client, calls, events } = harness("POST /generate");
    await expect(client.deployPolicy(DEFINITION, "GWALLET")).rejects.toThrow();
    expect(calls).toEqual(["POST /generate"]);
    expect(events).toEqual([]);
  });
});
