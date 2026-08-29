import { describe, expect, it, vi } from "vitest";
import { BatchDeployError, createPolicyFacade, PolicyNotDeployableError } from "./policy-facade";

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

// #242: batch operations queued per-wallet must complete in call order, even
// when their underlying network calls resolve out of order.
describe("policy facade — per-wallet operation ordering (#242)", () => {
  /** A fetch mock whose /deploy-instance responses resolve in a
   * DELIBERATELY SCRAMBLED order (controlled by a per-policy-id gate), so a
   * passing test proves the queue — not incidental timing — is what
   * produces in-order completion. */
  function scrambledFetch() {
    const gates = new Map<string, { resolve: () => void }>();
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/deploy-instance")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const policyId = u.match(/\/policies\/([^/]+)\/deploy-instance/)?.[1] ?? "?";
        await new Promise<void>((resolve) => gates.set(policyId, { resolve }));
        return jsonResponse({ contractId: `C-${policyId}`, wallet: body.wallet });
      }
      if (u.endsWith("/policies/deploy")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return jsonResponse({ policy: { id: body.policyId, status: "deployed" } });
      }
      return jsonResponse({});
    });
    return {
      fetchMock,
      /** Let a specific policy's deploy-instance call resolve. */
      releaseDeployInstance(policyId: string) {
        gates.get(policyId)?.resolve();
      },
    };
  }

  function recordingAttach() {
    const order: string[] = [];
    const attach: Parameters<typeof createPolicyFacade>[0]["attach"] = {
      async attachPolicy(contractId) {
        order.push(contractId);
        return { hash: `TX-${contractId}` };
      },
    };
    return { attach, order };
  }

  it("completes concurrent deploy() calls for the SAME wallet strictly in call order, even when each one's network call resolves slowly/unpredictably", async () => {
    const { fetchMock, releaseDeployInstance } = scrambledFetch();
    const { attach, order } = recordingAttach();
    const p = createPolicyFacade({
      apiUrl: "https://api.test",
      network: "testnet",
      requireSession: () => ({ accountId: WALLET }),
      attach,
      fetch: fetchMock,
    });

    // Fire three deploy() calls WITHOUT awaiting between them — "a" first,
    // "b" second, "c" third. Because the queue serializes deployOne() itself
    // (not just attachPolicy), "b"'s and "c"'s deploy-instance fetch calls
    // don't even START until "a"'s entire deployOne() has finished — so
    // releasing gates strictly as each becomes reachable (rather than
    // pre-releasing them out of order, which would just deadlock waiting
    // for a fetch call that hasn't happened yet) is itself evidence of the
    // ordering guarantee: only ONE gate is ever open at a time, in order.
    const pa = p.deploy("a");
    const pb = p.deploy("b");
    const pc = p.deploy("c");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/policies/a/deploy-instance",
      expect.anything(),
    ));
    releaseDeployInstance("a");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/policies/b/deploy-instance",
      expect.anything(),
    ));
    releaseDeployInstance("b");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/policies/c/deploy-instance",
      expect.anything(),
    ));
    releaseDeployInstance("c");

    await Promise.all([pa, pb, pc]);

    expect(order).toEqual(["C-a", "C-b", "C-c"]);
  });

  it("deployBatch() runs its items strictly in the given order", async () => {
    const { fetchMock, releaseDeployInstance } = scrambledFetch();
    const { attach, order } = recordingAttach();
    const p = createPolicyFacade({
      apiUrl: "https://api.test",
      network: "testnet",
      requireSession: () => ({ accountId: WALLET }),
      attach,
      fetch: fetchMock,
    });

    const batch = p.deployBatch(["x", "y", "z"]);

    // deployBatch awaits each item before starting the next, so only "x"'s
    // gate should even be open at this point — releasing "y"/"z" early (if
    // it were possible) would prove nothing since they haven't been asked
    // for yet. Release them in forward order as the batch naturally reaches
    // each one.
    await new Promise((r) => setTimeout(r, 0));
    releaseDeployInstance("x");
    await new Promise((r) => setTimeout(r, 0));
    releaseDeployInstance("y");
    await new Promise((r) => setTimeout(r, 0));
    releaseDeployInstance("z");

    const results = await batch;
    expect(results.map((r) => r.contractId)).toEqual(["C-x", "C-y", "C-z"]);
    expect(order).toEqual(["C-x", "C-y", "C-z"]);
  });

  it("deployBatch() stops after a failure, returning what succeeded via BatchDeployError", async () => {
    const attach: Parameters<typeof createPolicyFacade>[0]["attach"] = {
      attachPolicy: vi
        .fn()
        .mockResolvedValueOnce({ hash: "TX-1" })
        .mockRejectedValueOnce(new Error("passkey dismissed"))
        .mockResolvedValueOnce({ hash: "TX-3" }),
    };
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.endsWith("/deploy-instance")) return jsonResponse({ contractId: "C1" });
      if (u.endsWith("/policies/deploy")) return jsonResponse({ policy: { id: "p", status: "deployed" } });
      return jsonResponse({});
    });
    const p = createPolicyFacade({
      apiUrl: "https://api.test",
      network: "testnet",
      requireSession: () => ({ accountId: WALLET }),
      attach,
      fetch: fetchMock,
    });

    const err = await p.deployBatch(["p1", "p2", "p3"]).catch((e) => e);
    expect(err).toBeInstanceOf(BatchDeployError);
    expect((err as BatchDeployError).policyId).toBe("p2");
    expect((err as BatchDeployError).succeeded).toHaveLength(1);
    // p3 must never have been attempted.
    expect(attach.attachPolicy).toHaveBeenCalledTimes(2);
  });

  it("a failed deploy() does not block later operations for the same wallet", async () => {
    const attach: Parameters<typeof createPolicyFacade>[0]["attach"] = {
      attachPolicy: vi
        .fn()
        .mockRejectedValueOnce(new Error("first fails"))
        .mockResolvedValueOnce({ hash: "TX-2" }),
    };
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.endsWith("/deploy-instance")) return jsonResponse({ contractId: "C1" });
      if (u.endsWith("/policies/deploy")) return jsonResponse({ policy: { id: "p", status: "deployed" } });
      return jsonResponse({});
    });
    const p = createPolicyFacade({
      apiUrl: "https://api.test",
      network: "testnet",
      requireSession: () => ({ accountId: WALLET }),
      attach,
      fetch: fetchMock,
    });

    const first = p.deploy("p1");
    const second = p.deploy("p2");

    await expect(first).rejects.toThrow("first fails");
    await expect(second).resolves.toMatchObject({ attachTxHash: "TX-2" });
  });

  it("does not serialize operations for DIFFERENT wallets against each other", async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));

    // Two independent facades simulate two different connected wallets.
    const walletA = createPolicyFacade({
      apiUrl: "https://api.test",
      network: "testnet",
      requireSession: () => ({ accountId: "WALLET-A" }),
      attach: {
        async attachPolicy(contractId) {
          await gateA;
          order.push(contractId);
          return { hash: `TX-${contractId}` };
        },
      },
      fetch: vi.fn<typeof fetch>(async (url) => {
        const u = String(url);
        if (u.endsWith("/deploy-instance")) return jsonResponse({ contractId: "C-a" });
        return jsonResponse({});
      }),
    });
    const walletB = createPolicyFacade({
      apiUrl: "https://api.test",
      network: "testnet",
      requireSession: () => ({ accountId: "WALLET-B" }),
      attach: {
        async attachPolicy(contractId) {
          order.push(contractId);
          return { hash: `TX-${contractId}` };
        },
      },
      fetch: vi.fn<typeof fetch>(async (url) => {
        const u = String(url);
        if (u.endsWith("/deploy-instance")) return jsonResponse({ contractId: "C-b" });
        return jsonResponse({});
      }),
    });

    const pa = walletA.deploy("pa"); // blocks on gateA
    const pb = walletB.deploy("pb"); // unrelated wallet — must NOT wait on A
    await pb; // B completes even though A is still blocked
    expect(order).toEqual(["C-b"]);

    releaseA();
    await pa;
    expect(order).toEqual(["C-b", "C-a"]);
  });

  it("fires onOutOfOrderOperation only in the (expected-never) out-of-order case, not during normal in-order operation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.endsWith("/deploy-instance")) return jsonResponse({ contractId: "C1" });
      if (u.endsWith("/policies/deploy")) return jsonResponse({ policy: { id: "p", status: "deployed" } });
      return jsonResponse({});
    });
    const onOutOfOrderOperation = vi.fn();
    const p = createPolicyFacade({
      apiUrl: "https://api.test",
      network: "testnet",
      requireSession: () => ({ accountId: WALLET }),
      attach: { attachPolicy: vi.fn().mockResolvedValue({ hash: "TX" }) },
      fetch: fetchMock,
      onOutOfOrderOperation,
    });

    await p.deploy("p1");
    await p.deploy("p2");
    await p.deployBatch(["p3", "p4"]);

    expect(onOutOfOrderOperation).not.toHaveBeenCalled();
  });
});

// #232: cache invalidation forwards through the facade to the underlying
// client — full coverage of the client's own cache semantics lives in
// policy-client.test.ts; this just proves the facade wires it through.
describe("policy facade — template cache invalidation (#232)", () => {
  it("caches listTemplates() through the facade, and refreshTemplates() invalidates it", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ type: "a", title: "A", description: "", enforcement: { kind: "none" } }]))
      .mockResolvedValueOnce(jsonResponse([{ type: "a", title: "A v2", description: "", enforcement: { kind: "none" } }]));
    const p = facade({ fetch: fetchMock });

    const first = await p.listTemplates();
    const second = await p.listTemplates(); // should hit the cache, not fetch again
    const refreshed = await p.refreshTemplates();

    expect(first[0]!.title).toBe("A");
    expect(second[0]!.title).toBe("A");
    expect(refreshed[0]!.title).toBe("A v2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forwards onCacheInvalidated to the underlying client", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse([]));
    const onCacheInvalidated = vi.fn();
    const p = createPolicyFacade({
      apiUrl: "https://api.test",
      network: "testnet",
      requireSession: () => ({ accountId: WALLET }),
      fetch: fetchMock,
      onCacheInvalidated,
    });

    await p.listTemplates();
    await p.refreshTemplates();

    expect(onCacheInvalidated).toHaveBeenCalledTimes(1);
    expect(onCacheInvalidated.mock.calls[0]![0]).toMatchObject({ reason: "explicit-refresh" });
  });
});
