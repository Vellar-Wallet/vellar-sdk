// #660 — a deployed policy instance does not depend on the templates catalog.
//
// The catalog is a provisioning aid. Once an instance is deployed, removing or
// changing its template must not stop a read or a re-simulation. Maintainers
// can move this file to src/policy-facade.test.ts; it already drives the real
// facade. The README paragraph to paste is in contrib/README.md.

import { describe, expect, it, vi } from "vitest";
import { createPolicyFacade, PolicyNotDeployableError } from "../src/policy-facade";
import { PolicyApiError, type PolicyTemplateInfo } from "../src/policy-types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const WALLET = "CWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDE";
const SPENDING = "spending-limit";
const VERIFIED = "verified-recipient";
const DEPLOYED_ID = "pol_deployed";

function facade(opts: {
  attach?: Parameters<typeof createPolicyFacade>[0]["attach"];
  fetch?: typeof fetch;
}) {
  return createPolicyFacade({
    apiUrl: "https://api.test",
    network: "testnet",
    requireSession: () => ({ accountId: WALLET, keyId: "key-1" }),
    attach: opts.attach,
    fetch: opts.fetch,
  });
}

function template(type: string): PolicyTemplateInfo {
  return { type, title: type, description: "", enforcement: { kind: "signer-limits" } };
}

const DEPLOYED_POLICY = {
  id: DEPLOYED_ID,
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "deployed" as const,
  definition: { version: "1", type: SPENDING, owners: [WALLET] },
  policyHash: "hash",
  manifest: {
    template: SPENDING,
    enforcement: { kind: "signer-limits" as const },
    network: "testnet" as const,
  },
  deployment: {
    contractId: "CINSTANCEORPHAN",
    txHash: "ATTACHTX",
    deployedAt: "2026-01-02T00:00:00.000Z",
  },
};

function catalogFetch(
  templates: () => PolicyTemplateInfo[],
  simulate: { status?: number; body?: unknown } = {},
) {
  return vi.fn<typeof fetch>(async (url) => {
    const u = String(url);
    if (u.endsWith("/templates")) return jsonResponse(templates());
    if (u.endsWith(`/${DEPLOYED_ID}/simulate`)) {
      return jsonResponse(simulate.body ?? { ok: true, minResourceFee: "42" }, simulate.status ?? 200);
    }
    if (u.endsWith("/policies")) return jsonResponse([DEPLOYED_POLICY]);
    return jsonResponse({});
  });
}

describe("deployed policy after its template leaves the catalog (#660)", () => {
  it("reads and re-simulates an instance whose template id is gone from listTemplates", async () => {
    const p = facade({ fetch: catalogFetch(() => [template(VERIFIED)]) });

    expect((await p.listTemplates()).map((t) => t.type)).not.toContain(SPENDING);
    await expect(p.simulate(DEPLOYED_ID)).resolves.toEqual({ ok: true, minResourceFee: "42" });

    const policies = await p.client.listPolicies();
    expect(policies).toEqual([DEPLOYED_POLICY]);
    expect(policies[0]?.manifest.template).toBe(SPENDING);
  });

  it("a catalog update cannot change the result of an already-deployed policy", async () => {
    let catalog = [template(SPENDING), template(VERIFIED)];
    const p = facade({ fetch: catalogFetch(() => catalog) });

    const before = await p.simulate(DEPLOYED_ID);
    expect((await p.listTemplates()).map((t) => t.type)).toContain(SPENDING);

    catalog = [template(VERIFIED)];
    const after = await p.simulate(DEPLOYED_ID);

    expect((await p.listTemplates()).map((t) => t.type)).toEqual([VERIFIED]);
    expect(after).toEqual(before);
  });

  it("a templates outage does not block re-simulation of a deployed instance", async () => {
    let templatesDown = false;
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.endsWith("/templates")) {
        if (templatesDown) return jsonResponse({ message: "catalog unavailable" }, 503);
        return jsonResponse([template(SPENDING)]);
      }
      if (u.endsWith(`/${DEPLOYED_ID}/simulate`)) return jsonResponse({ ok: true, minResourceFee: "42" });
      return jsonResponse({});
    });
    const p = facade({ fetch: fetchMock });

    expect((await p.listTemplates()).map((t) => t.type)).toEqual([SPENDING]);
    templatesDown = true;
    await expect(p.listTemplates()).rejects.toBeInstanceOf(PolicyApiError);
    await expect(p.simulate(DEPLOYED_ID)).resolves.toEqual({ ok: true, minResourceFee: "42" });
  });

  it("surfaces an API error for a missing policy id instead of blaming the catalog", async () => {
    const p = facade({
      fetch: catalogFetch(() => [], { status: 404, body: { message: "policy not found" } }),
    });
    expect(await p.listTemplates()).toEqual([]);
    await expect(p.simulate(DEPLOYED_ID)).rejects.toMatchObject({
      name: "PolicyApiError",
      status: 404,
      message: "policy not found",
    });
  });

  it("still refuses deploy when no attach runtime is configured", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const p = facade({ fetch: fetchMock });
    await expect(p.deploy("p1")).rejects.toBeInstanceOf(PolicyNotDeployableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
