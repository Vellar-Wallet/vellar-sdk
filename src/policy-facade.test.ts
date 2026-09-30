import { describe, expect, it, vi } from "vitest";
import { createPolicyFacade, PolicyNotDeployableError, DeployPolicyError } from "./policy-facade";
import { PolicyApiError } from "./policy-types";

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

describe("policy facade — resume after lost attach response", () => {
  it("resumeDeploy completes only the record step", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/policies/deploy")) {
        return jsonResponse({ policy: { id: "p1", status: "deployed" } });
      }
      return jsonResponse({});
    });

    const p = facade({ fetch: fetchMock });
    const result = await p.resumeDeploy("p1", "ATTACHTX", "CINSTANCE");

    expect(result).toEqual({
      policy: { id: "p1", status: "deployed" },
      contractId: "CINSTANCE",
      attachTxHash: "ATTACHTX",
    });
    // Only the record endpoint should be hit.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/policies/deploy");
  });

  it("resumeDeploy does NOT issue a passkey prompt", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ policy: { id: "p1", status: "deployed" } }),
    );
    const attach = {
      resume: vi.fn(async () => {}),
      attachPolicy: vi.fn(async () => ({ hash: "TX" })),
    };

    const p = facade({ attach, fetch: fetchMock });
    await p.resumeDeploy("p1", "ATTACHTX");

    expect(attach.resume).not.toHaveBeenCalled();
    expect(attach.attachPolicy).not.toHaveBeenCalled();
  });
});

describe("policy facade — deploy failure surfaces resume state", () => {
  it("throws DeployPolicyError with contractId when attach fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/deploy-instance")) {
        return jsonResponse({ contractId: "CINSTANCE" });
      }
      return jsonResponse({});
    });
    const attach = {
      attachPolicy: vi.fn(async () => {
        throw new Error("passkey failed");
      }),
    };

    const p = facade({ attach, fetch: fetchMock });
    await expect(p.deploy("p1")).rejects.toMatchObject({
      name: "DeployPolicyError",
      contractId: "CINSTANCE",
      attachHash: undefined,
    });
  });

  it("throws DeployPolicyError with contractId and attachHash when record fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/deploy-instance")) {
        return jsonResponse({ contractId: "CINSTANCE" });
      }
      if (String(url).endsWith("/policies/deploy")) {
        return new Response(JSON.stringify({ error: "server down" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonResponse({});
    });
    const attach = {
      attachPolicy: vi.fn(async () => ({ hash: "ATTACHTX" })),
    };

    const p = facade({ attach, fetch: fetchMock });
    await expect(p.deploy("p1")).rejects.toMatchObject({
      name: "DeployPolicyError",
      contractId: "CINSTANCE",
      attachHash: "ATTACHTX",
    });
  });
});

describe("policy facade — retryable error handling", () => {
  it("retries deploy-instance on 503 retryable error", async () => {
    let calls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/deploy-instance")) {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        return jsonResponse({ contractId: "CINSTANCE" });
      }
      if (String(url).endsWith("/policies/deploy")) {
        return jsonResponse({ policy: { id: "p1", status: "deployed" } });
      }
      return jsonResponse({});
    });
    const attach = {
      attachPolicy: vi.fn(async () => ({ hash: "TX" })),
    };

    const p = facade({ attach, fetch: fetchMock });
    const result = await p.deploy("p1");
    expect(result.contractId).toBe("CINSTANCE");
    expect(calls).toBe(2);
  });

  it("does NOT retry on 422 terminal error", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/deploy-instance")) {
        return new Response(JSON.stringify({ error: "attach_mismatch" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonResponse({});
    });
    const attach = {
      attachPolicy: vi.fn(async () => ({ hash: "TX" })),
    };

    const p = facade({ attach, fetch: fetchMock });
    await expect(p.deploy("p1")).rejects.toBeInstanceOf(PolicyApiError);
    // Only 1 call — no retry on terminal 422.
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});