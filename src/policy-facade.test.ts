import { describe, expect, it, vi } from "vitest";
import { createPolicyFacade, PolicyNotDeployableError } from "./policy-facade";
import { PolicyApiError, type PolicyTemplateInfo } from "./policy-types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const WALLET = "CWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDE";

function facade(opts: {
  attach?: Parameters<typeof createPolicyFacade>[0]["attach"];
  session?: { accountId: string; keyId?: string } | null;
  fetch?: typeof fetch;
}) {
  const session = opts.session === undefined ? { accountId: WALLET, keyId: "key-1" } : opts.session;
  return createPolicyFacade({
    apiUrl: "https://api.test",
    network: "testnet",
    requireSession: () => {
      if (!session) throw new Error("not ready");
      return session;
    },
    attach: opts.attach,
    fetch: opts.fetch,
  });
}

describe("policy facade — deploy orchestration", () => {
  it("runs deploy-instance → attach (passkey) → record, in order", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.endsWith("/deploy-instance")) {
        calls.push("deploy-instance");
        return jsonResponse({ contractId: "CINSTANCE" });
      }
      if (u.endsWith("/policies/deploy")) {
        calls.push("record");
        return jsonResponse({ policy: { id: "p1", status: "deployed" } });
      }
      return jsonResponse({});
    });

    const attach = {
      resume: vi.fn(async () => {
        calls.push("resume");
      }),
      attachPolicy: vi.fn(async () => {
        calls.push("attach");
        return { hash: "ATTACHTX" };
      }),
    };

    const p = facade({ attach, fetch: fetchMock });
    const result = await p.deploy("p1");

    expect(result).toEqual({
      policy: { id: "p1", status: "deployed" },
      contractId: "CINSTANCE",
      attachTxHash: "ATTACHTX",
    });
    // Order matters: instance is deployed, THEN passkey resume+attach, THEN record.
    expect(calls).toEqual(["deploy-instance", "resume", "attach", "record"]);
    // attach was called with the instance contract id.
    expect(attach.attachPolicy).toHaveBeenCalledWith("CINSTANCE");
  });

  it("skips resume when the session has no keyId", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/deploy-instance")
        ? jsonResponse({ contractId: "CINSTANCE" })
        : jsonResponse({ policy: { id: "p1", status: "deployed" } }),
    );
    const attach = {
      resume: vi.fn(async () => {}),
      attachPolicy: vi.fn(async () => ({ hash: "TX" })),
    };
    const p = facade({ attach, fetch: fetchMock, session: { accountId: WALLET } });
    await p.deploy("p1");
    expect(attach.resume).not.toHaveBeenCalled();
    expect(attach.attachPolicy).toHaveBeenCalled();
  });

  it("throws PolicyNotDeployableError when no attach runtime is configured", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const p = facade({ attach: undefined, fetch: fetchMock });
    await expect(p.deploy("p1")).rejects.toBeInstanceOf(PolicyNotDeployableError);
    // Must fail BEFORE hitting the network (no wasted sponsor deploy).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("simulate() uses the connected wallet's account id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }));
    const p = facade({ fetch: fetchMock });
    await p.simulate("p1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/policies/p1/simulate");
    expect(JSON.parse(init!.body as string)).toEqual({ wallet: WALLET });
  });
});

const SPENDING = "spending-limit";
const VERIFIED = "verified-recipient";
const DEPLOYED_ID = "pol_deployed";

function template(type: string): PolicyTemplateInfo {
  return {
    type,
    title: type,
    description: "",
    enforcement: { kind: "signer-limits" },
  };
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
  deployment: { contractId: "CINSTANCEORPHAN", txHash: "ATTACHTX", deployedAt: "2026-01-02T00:00:00.000Z" },
};

/**
 * Catalog responses are swappable so a test can remove a template after the
 * instance already exists — the situation a support ticket would hit.
 */
function catalogFetch(templates: () => PolicyTemplateInfo[], simulate: { status?: number; body?: unknown } = {}) {
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

describe("deployed policy after its template leaves the catalog", () => {
  it("reads and re-simulates an instance whose template id is gone from listTemplates", async () => {
    const fetchMock = catalogFetch(() => [template(VERIFIED)]);
    const p = facade({ fetch: fetchMock });

    const listed = await p.listTemplates();
    expect(listed.map((t) => t.type)).not.toContain(SPENDING);

    const simulated = await p.simulate(DEPLOYED_ID);
    expect(simulated).toEqual({ ok: true, minResourceFee: "42" });

    const policies = await p.client.listPolicies();
    expect(policies).toEqual([DEPLOYED_POLICY]);
    expect(policies[0]?.manifest.template).toBe(SPENDING);
  });

  it("a catalog update cannot change the result of an already-deployed policy", async () => {
    let catalog = [template(SPENDING), template(VERIFIED)];
    const fetchMock = catalogFetch(() => catalog);
    const p = facade({ fetch: fetchMock });

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
    const fetchMock = catalogFetch(() => [], { status: 404, body: { message: "policy not found" } });
    const p = facade({ fetch: fetchMock });

    expect(await p.listTemplates()).toEqual([]);
    await expect(p.simulate(DEPLOYED_ID)).rejects.toMatchObject({
      name: "PolicyApiError",
      status: 404,
      message: "policy not found",
    });
  });
});
