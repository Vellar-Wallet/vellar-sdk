import { describe, expect, it, vi } from "vitest";
import { createPolicyFacade, PolicyNotDeployableError } from "./policy-facade";

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
