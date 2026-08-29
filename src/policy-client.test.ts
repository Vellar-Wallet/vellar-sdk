import { describe, expect, it, vi } from "vitest";
import type { PolicyDefinition } from "./types";
import { createPolicyClient, PolicyListFilterError } from "./policy-client";
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

  it("caches listTemplates() — a second call does not re-fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse([
        { type: "spending_limit", title: "Spending limit", description: "", enforcement: { kind: "none" } },
      ]),
    );
    const client = createPolicyClient({ apiUrl: "https://api.test", network: "testnet", fetch: fetchMock });

    const first = await client.listTemplates();
    const second = await client.listTemplates();

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent listTemplates() calls into one request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse([
        { type: "spending_limit", title: "Spending limit", description: "", enforcement: { kind: "none" } },
      ]),
    );
    const client = createPolicyClient({ apiUrl: "https://api.test", network: "testnet", fetch: fetchMock });

    const [a, b, c] = await Promise.all([
      client.listTemplates(),
      client.listTemplates(),
      client.listTemplates(),
    ]);

    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("generate() invalidates the templates cache — a subsequent listTemplates() re-fetches", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          { type: "spending_limit", title: "Spending limit", description: "", enforcement: { kind: "none" } },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ policy: { id: "p1", status: "generated" } }))
      .mockResolvedValueOnce(
        jsonResponse([
          { type: "spending_limit", title: "Spending limit (updated)", description: "", enforcement: { kind: "none" } },
        ]),
      );
    const client = createPolicyClient({ apiUrl: "https://api.test", network: "testnet", fetch: fetchMock });

    await client.listTemplates(); // populates the cache
    await client.generate(definition); // should invalidate it
    const templates = await client.listTemplates(); // should re-fetch, not read stale cache

    expect(templates[0]!.title).toBe("Spending limit (updated)");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshTemplates() invalidates the cache and re-fetches even without an intervening mutation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse([
          { type: "spending_limit", title: "Spending limit", description: "", enforcement: { kind: "none" } },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { type: "spending_limit", title: "Spending limit v2", description: "", enforcement: { kind: "none" } },
        ]),
      );
    const client = createPolicyClient({ apiUrl: "https://api.test", network: "testnet", fetch: fetchMock });

    await client.listTemplates();
    const refreshed = await client.refreshTemplates();

    expect(refreshed[0]!.title).toBe("Spending limit v2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fires onCacheInvalidated with reason 'template-update' when generate() invalidates a populated cache", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ policy: { id: "p1", status: "generated" } }));
    const onCacheInvalidated = vi.fn();
    const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: fetchMock,
      onCacheInvalidated,
      now: fixedNow,
    });

    await client.listTemplates(); // populate the cache first
    await client.generate(definition);

    expect(onCacheInvalidated).toHaveBeenCalledTimes(1);
    expect(onCacheInvalidated).toHaveBeenCalledWith({
      cache: "templates",
      reason: "template-update",
      at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("fires onCacheInvalidated with reason 'explicit-refresh' from refreshTemplates()", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([]));
    const onCacheInvalidated = vi.fn();
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: fetchMock,
      onCacheInvalidated,
    });

    await client.listTemplates();
    await client.refreshTemplates();

    expect(onCacheInvalidated).toHaveBeenCalledTimes(1);
    expect(onCacheInvalidated.mock.calls[0]![0]).toMatchObject({
      cache: "templates",
      reason: "explicit-refresh",
    });
  });

  it("does not fire onCacheInvalidated when generate() runs before the cache was ever populated", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ policy: { id: "p1", status: "generated" } }),
    );
    const onCacheInvalidated = vi.fn();
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: fetchMock,
      onCacheInvalidated,
    });

    // No listTemplates() call first — nothing was ever cached.
    await client.generate(definition);

    expect(onCacheInvalidated).not.toHaveBeenCalled();
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

  it("listPolicies() passes status and date filters as query params", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse([{ id: "p1", status: "generated", createdAt: "2026-01-01T00:00:00Z" }]),
    );
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: fetchMock,
    });

    await client.listPolicies({
      status: "active",
      createdAfter: "2026-01-01T00:00:00Z",
      createdBefore: "2026-12-31T23:59:59Z",
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.test/policies?status=active&created_after=2026-01-01T00%3A00%3A00Z&created_before=2026-12-31T23%3A59%3A59Z",
    );
  });

  it("listPolicies() rejects malformed createdAfter", () => {
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: vi.fn(),
    });
    expect(() => client.listPolicies({ createdAfter: "not-a-date" })).toThrow(
      PolicyListFilterError,
    );
  });

  it("listPolicies() rejects malformed createdBefore", () => {
    const client = createPolicyClient({
      apiUrl: "https://api.test",
      network: "testnet",
      fetch: vi.fn(),
    });
    expect(() => client.listPolicies({ createdBefore: "also-bad" })).toThrow(
      PolicyListFilterError,
    );
  });

  it("listPolicies() accepts each status filter independently", async () => {
    for (const status of ["active", "draft", "revoked"] as const) {
      const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([]));
      const client = createPolicyClient({
        apiUrl: "https://api.test",
        network: "testnet",
        fetch: fetchMock,
      });
      await client.listPolicies({ status });
      expect(String(fetchMock.mock.calls[0]![0])).toContain(`status=${status}`);
    }
  });
});

describe("V-10 (RA-11-E) — retryable and terminal failures are distinguishable", () => {
  // /policies/deploy has two failure modes with OPPOSITE correct responses:
  //   503 attach_unconfirmed — chain pending, record NOT stamped -> RETRY
  //   422 attach_mismatch    — a lie,        record NOT stamped -> DO NOT RETRY
  // Both used to surface as an identical PolicyApiError.
  const err = (status: number) => new PolicyApiError("x", status);

  it("marks 503 attach_unconfirmed retryable", () => {
    expect(err(503).retryable).toBe(true);
  });

  it("marks 422 attach_mismatch TERMINAL — retrying repeats the lie", () => {
    expect(err(422).retryable).toBe(false);
  });

  it("treats a transport failure as retryable — nothing was decided", () => {
    expect(err(0).retryable).toBe(true);
  });

  it("treats ordinary 4xx as terminal", () => {
    for (const s of [400, 401, 403, 404]) expect(err(s).retryable).toBe(false);
  });

  it("excepts 408 and 429 — those say 'not now', not 'not ever'", () => {
    expect(err(408).retryable).toBe(true);
    expect(err(429).retryable).toBe(true);
  });

  it("treats other 5xx as retryable", () => {
    for (const s of [500, 502, 504]) expect(err(s).retryable).toBe(true);
  });

  it("still carries status and errors, so existing callers are unaffected", () => {
    const e = new PolicyApiError("boom", 422, ["bad"]);
    expect(e.status).toBe(422);
    expect(e.errors).toEqual(["bad"]);
    expect(e.name).toBe("PolicyApiError");
  });
});
