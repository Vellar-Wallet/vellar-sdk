import { describe, expect, it, vi } from "vitest";
import type { PolicyDefinition } from "./types";
import { createPolicyClient } from "./policy-client";
import { PolicyApiError } from "./policy-types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Typed as the real PolicyDefinition — no `as never` cast, so the fixture is
// actually checked against the shape the client accepts.
const definition: PolicyDefinition = {
  version: "1",
  type: "spending_limit",
  owners: ["CAFK7NMQOT7G2SKMREDUII3EOK4APIY54WIK6CVGY72XWFE76YFRDF67"],
  spendingLimits: { dailyXlm: "100" },
};

describe("createPolicyClient", () => {
  it("lists templates", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse([
        {
          type: "spending_limit",
          title: "Spending limit",
          description: "",
          enforcement: { kind: "none" },
        },
      ]),
    );
    const client = createPolicyClient({
      apiUrl: "https://api.test/",
      network: "testnet",
      fetch: fetchMock,
    });
    const templates = await client.listTemplates();
    expect(templates[0]!.type).toBe("spending_limit");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/policies/templates");
  });

  it("generate() posts the definition + network and returns the policy", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ policy: { id: "p1", status: "generated" } }),
    );
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: fetchMock,
    });
    const policy = await client.generate(definition);
    expect(policy.id).toBe("p1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/policies/generate");
    expect(JSON.parse(init!.body as string)).toMatchObject({ network: "testnet" });
  });

  it("simulate() and deployInstance() target the policy id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/simulate"))
        return jsonResponse({ ok: true, minResourceFee: "123" });
      return jsonResponse({ contractId: "CINSTANCE" });
    });
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: fetchMock,
    });

    const sim = await client.simulate("p1", "CWALLET");
    expect(sim.ok).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/policies/p1/simulate");

    const { contractId } = await client.deployInstance("p1", "CWALLET");
    expect(contractId).toBe("CINSTANCE");
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.test/policies/p1/deploy-instance");
  });

  it("recordDeployment() posts the attach tx", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ policy: { id: "p1", status: "deployed" } }),
    );
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: fetchMock,
    });
    const policy = await client.recordDeployment("p1", "TXHASH", "CINSTANCE");
    expect(policy.status).toBe("deployed");
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toMatchObject({
      policyId: "p1",
      txHash: "TXHASH",
      contractId: "CINSTANCE",
    });
  });

  it("throws a typed PolicyApiError on non-2xx, surfacing field errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "invalid_policy", errors: ["set dailyXlm and/or perTxXlm"] }, 422),
    );
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: fetchMock,
    });
    await expect(client.generate(definition)).rejects.toMatchObject({
      name: "PolicyApiError",
      status: 422,
      errors: ["set dailyXlm and/or perTxXlm"],
    });
  });

  it("wraps a network failure as PolicyApiError status 0", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: fetchMock,
    });
    await expect(client.listTemplates()).rejects.toBeInstanceOf(PolicyApiError);
    await expect(client.listTemplates()).rejects.toMatchObject({ status: 0 });
  });
});
